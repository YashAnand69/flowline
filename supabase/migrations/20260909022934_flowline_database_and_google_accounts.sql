-- Server-only records: the browser never receives a service key.
create table public.flowline_records (
  scope text not null,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (scope, key)
);
create index flowline_records_prefix on public.flowline_records (scope, key text_pattern_ops);
alter table public.flowline_records enable row level security;
revoke all on public.flowline_records from public, anon, authenticated;
grant select, insert, update, delete on public.flowline_records to service_role;

create table public.flowline_google_accounts (
  scope text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null,
  email text not null,
  display_name text not null,
  created_at timestamptz not null default now(),
  primary key (scope, user_id),
  unique (scope, workspace_id)
);
alter table public.flowline_google_accounts enable row level security;
revoke all on public.flowline_google_accounts from public, anon, authenticated;
grant select, insert, update, delete on public.flowline_google_accounts to service_role;

-- Invoker privileges, explicit server-only execution, and a unique account/workspace
-- binding prevent races from attaching two Google accounts to a private workspace.
create function public.flowline_bind_google(
  p_scope text, p_user_id uuid, p_email text, p_name text, p_workspace_id uuid default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare account_workspace uuid; result jsonb; target uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_scope || p_user_id::text, 0));
  select workspace_id into account_workspace from public.flowline_google_accounts
    where scope = p_scope and user_id = p_user_id;
  if account_workspace is not null then
    if p_workspace_id is not null and p_workspace_id <> account_workspace then
      raise exception 'This Google account already belongs to another workspace.';
    end if;
    target := account_workspace;
  else
    target := coalesce(p_workspace_id, p_user_id);
    if p_workspace_id is not null then
      select value into result from public.flowline_records
        where scope = p_scope and key = 'workspaces/' || target::text for update;
      if result is null or result = 'null'::jsonb then raise exception 'Workspace not found.'; end if;
    else
      insert into public.flowline_records(scope, key, value)
      values(p_scope, 'workspaces/' || target::text, jsonb_build_object(
        'id', target, 'name', left(p_name, 60) || '''s workspace',
        'createdAt', now(), 'recoveryHash', ''
      )) on conflict(scope, key) do nothing;
    end if;
    insert into public.flowline_google_accounts(scope, user_id, workspace_id, email, display_name)
      values(p_scope, p_user_id, target, p_email, p_name);
  end if;
  update public.flowline_google_accounts set email = p_email, display_name = p_name
    where scope = p_scope and user_id = p_user_id;
  update public.flowline_records set value = value || jsonb_build_object(
    'googleUserId', p_user_id, 'email', p_email, 'displayName', p_name
  ), updated_at = now() where scope = p_scope and key = 'workspaces/' || target::text
    returning value into result;
  return result;
end;
$$;
revoke all on function public.flowline_bind_google(text, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.flowline_bind_google(text, uuid, text, text, uuid) to service_role;
