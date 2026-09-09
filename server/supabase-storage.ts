import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Storage } from './storage';
import type { Workspace } from '../shared/model';
import type { GoogleProfile } from './google';

export class SupabaseStorage implements Storage {
  private client: SupabaseClient;
  constructor(
    url: string,
    secretKey: string,
    private scope = 'production',
  ) {
    this.client = createClient(url, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  private check(error: { message: string } | null) {
    if (error) throw new Error('Database request failed.');
  }
  async get<T>(key: string): Promise<T | null> {
    const { data, error } = await this.client
      .from('flowline_records')
      .select('value')
      .eq('scope', this.scope)
      .eq('key', key)
      .maybeSingle();
    this.check(error);
    return data?.value ?? null;
  }
  async set(key: string, value: unknown) {
    const { error } = await this.client
      .from('flowline_records')
      .upsert(
        { scope: this.scope, key, value, updated_at: new Date().toISOString() },
        { onConflict: 'scope,key' },
      );
    this.check(error);
  }
  async delete(key: string) {
    const { error } = await this.client
      .from('flowline_records')
      .delete()
      .eq('scope', this.scope)
      .eq('key', key);
    this.check(error);
  }
  async list<T>(prefix: string): Promise<T[]> {
    const rows: T[] = [];
    // All pages are read, including histories exceeding PostgREST's default cap.
    const escaped = prefix.replace(/[\\%_]/g, '\\$&');
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await this.client
        .from('flowline_records')
        .select('value')
        .eq('scope', this.scope)
        .like('key', `${escaped}%`)
        .order('key')
        .range(offset, offset + 499);
      this.check(error);
      rows.push(...(data || []).map((row) => row.value as T));
      if (!data || data.length < 500) return rows;
    }
  }
  async bindGoogle(
    profile: GoogleProfile,
    workspaceId?: string,
  ): Promise<Workspace> {
    const { data, error } = await this.client.rpc('flowline_bind_google', {
      p_scope: this.scope,
      p_user_id: profile.id,
      p_email: profile.email,
      p_name: profile.name,
      p_workspace_id: workspaceId ?? null,
    });
    if (error)
      throw new Error(
        'This Google account or workspace is already linked. Sign in separately to open its workspace.',
      );
    if (!data?.id) throw new Error('Could not open the Google workspace.');
    return data as Workspace;
  }
}
