create table if not exists public.user_connections (
  workos_user_id text primary key,
  github_user_id bigint not null,
  github_login text not null,
  access_token_encrypted text not null,
  refresh_token_encrypted text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  installation_id bigint,
  repository_full_name text,
  branch text not null default 'main',
  time_zone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint repository_name_format check (
    repository_full_name is null or repository_full_name ~ '^[^/]+/[^/]+$'
  )
);

alter table public.user_connections enable row level security;
revoke all on table public.user_connections from public, anon, authenticated;
grant usage on schema public to service_role;
grant select, insert, update, delete on table public.user_connections to service_role;

comment on table public.user_connections is
  'Server-only encrypted GitHub connections keyed by the WorkOS AuthKit subject.';
