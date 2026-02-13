-- ============================================================
-- GiuseCoder Database Schema
-- ============================================================

-- Enable required extensions
create extension if not exists "pgcrypto";

-- ============================================================
-- 1. PROFILES (extends Supabase auth.users)
-- ============================================================
create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    email text,
    display_name text,
    avatar_url text,
    plan text not null default 'free' check (plan in ('free', 'pro', 'team', 'enterprise')),
    max_monthly_cost_usd numeric(10,4) not null default 10.0000,
    preferences jsonb not null default '{}',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

comment on table public.profiles is 'User profiles extending Supabase auth';

-- ============================================================
-- 2. API_KEYS (encrypted provider keys per user)
-- ============================================================
create table public.api_keys (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles(id) on delete cascade,
    provider text not null check (provider in ('anthropic', 'openai')),
    encrypted_key text not null,
    key_hint text,
    is_valid boolean not null default true,
    last_verified_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    unique (user_id, provider)
);

comment on table public.api_keys is 'Encrypted API keys per provider per user';

-- ============================================================
-- 3. SESSIONS (chat sessions / conversations)
-- ============================================================
create table public.sessions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles(id) on delete cascade,
    title text,
    model text not null default 'claude-sonnet-4-20250514',
    orchestrator_mode text not null default 'orchestrated' check (orchestrator_mode in ('orchestrated', 'single')),
    message_count integer not null default 0,
    total_input_tokens bigint not null default 0,
    total_output_tokens bigint not null default 0,
    total_cost_usd numeric(10,4) not null default 0.0000,
    metadata jsonb not null default '{}',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index idx_sessions_user_id on public.sessions(user_id);
create index idx_sessions_created_at on public.sessions(created_at desc);

comment on table public.sessions is 'Chat sessions / conversations';

-- ============================================================
-- 4. MESSAGES (individual chat messages within a session)
-- ============================================================
create table public.messages (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null references public.sessions(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete cascade,
    role text not null check (role in ('user', 'assistant', 'system')),
    content text not null default '',
    model text,
    input_tokens integer not null default 0,
    output_tokens integer not null default 0,
    cost_usd numeric(10,6) not null default 0.000000,
    metadata jsonb not null default '{}',
    created_at timestamptz not null default now()
);

create index idx_messages_session_id on public.messages(session_id, created_at);
create index idx_messages_user_id on public.messages(user_id);

comment on table public.messages is 'Individual chat messages within sessions';

-- ============================================================
-- 5. PIPELINE_RUNS (one per orchestrated request)
-- ============================================================
create table public.pipeline_runs (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null references public.sessions(id) on delete cascade,
    message_id uuid references public.messages(id) on delete set null,
    user_id uuid not null references public.profiles(id) on delete cascade,
    task_type text not null default 'unknown',
    status text not null default 'running' check (status in ('running', 'completed', 'failed', 'cancelled')),
    total_steps integer not null default 0,
    completed_steps integer not null default 0,
    total_input_tokens bigint not null default 0,
    total_output_tokens bigint not null default 0,
    total_cost_usd numeric(10,6) not null default 0.000000,
    duration_ms integer not null default 0,
    error_message text,
    review_approved boolean,
    fix_rounds integer not null default 0,
    metadata jsonb not null default '{}',
    created_at timestamptz not null default now(),
    completed_at timestamptz
);

create index idx_pipeline_runs_session on public.pipeline_runs(session_id);
create index idx_pipeline_runs_user on public.pipeline_runs(user_id, created_at desc);
create index idx_pipeline_runs_task_type on public.pipeline_runs(task_type);

comment on table public.pipeline_runs is 'Multi-agent orchestration pipeline executions';

-- ============================================================
-- 6. PIPELINE_STEPS (individual agent steps within a pipeline)
-- ============================================================
create table public.pipeline_steps (
    id uuid primary key default gen_random_uuid(),
    pipeline_run_id uuid not null references public.pipeline_runs(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete cascade,
    step_id text not null,
    step_index integer not null default 0,
    agent text not null check (agent in ('haiku', 'opus', 'sonnet', 'codex')),
    action text not null,
    label text not null default '',
    status text not null default 'waiting' check (status in ('waiting', 'running', 'done', 'failed', 'skipped')),
    model text not null,
    input_tokens integer not null default 0,
    output_tokens integer not null default 0,
    cost_usd numeric(10,6) not null default 0.000000,
    duration_ms integer not null default 0,
    error_message text,
    output_preview text,
    is_parallel boolean not null default false,
    created_at timestamptz not null default now(),
    completed_at timestamptz
);

create index idx_pipeline_steps_run on public.pipeline_steps(pipeline_run_id, step_index);
create index idx_pipeline_steps_agent on public.pipeline_steps(agent);

comment on table public.pipeline_steps is 'Individual agent steps within a pipeline run';

-- ============================================================
-- 7. AGENT_USAGE (aggregated per-agent usage stats)
-- ============================================================
create table public.agent_usage (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles(id) on delete cascade,
    agent text not null check (agent in ('haiku', 'opus', 'sonnet', 'codex')),
    period_start date not null,
    period_end date not null,
    request_count integer not null default 0,
    total_input_tokens bigint not null default 0,
    total_output_tokens bigint not null default 0,
    total_cost_usd numeric(10,4) not null default 0.0000,
    avg_latency_ms integer not null default 0,
    error_count integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    unique (user_id, agent, period_start)
);

create index idx_agent_usage_user_period on public.agent_usage(user_id, period_start desc);

comment on table public.agent_usage is 'Aggregated daily usage stats per agent per user';

-- ============================================================
-- 8. COST_LEDGER (immutable cost transaction log)
-- ============================================================
create table public.cost_ledger (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles(id) on delete cascade,
    pipeline_run_id uuid references public.pipeline_runs(id) on delete set null,
    pipeline_step_id uuid references public.pipeline_steps(id) on delete set null,
    agent text not null check (agent in ('haiku', 'opus', 'sonnet', 'codex')),
    model text not null,
    action text not null,
    input_tokens integer not null default 0,
    output_tokens integer not null default 0,
    cost_usd numeric(10,6) not null default 0.000000,
    currency text not null default 'USD',
    created_at timestamptz not null default now()
);

create index idx_cost_ledger_user on public.cost_ledger(user_id, created_at desc);
create index idx_cost_ledger_agent on public.cost_ledger(agent);
create index idx_cost_ledger_pipeline on public.cost_ledger(pipeline_run_id);

comment on table public.cost_ledger is 'Immutable cost transaction log for billing and analytics';

-- ============================================================
-- 9. USER_SETTINGS (synced extension settings)
-- ============================================================
create table public.user_settings (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles(id) on delete cascade unique,
    orchestrator_enabled boolean not null default true,
    auto_review boolean not null default true,
    auto_fix boolean not null default true,
    parallel_execution boolean not null default true,
    cost_warning_threshold numeric(10,4) not null default 0.5000,
    default_mode text not null default 'orchestrated' check (default_mode in ('orchestrated', 'single')),
    codex_reasoning_effort text not null default 'high' check (codex_reasoning_effort in ('low', 'medium', 'high')),
    max_fix_rounds integer not null default 1 check (max_fix_rounds between 0 and 3),
    model_haiku text not null default 'claude-haiku-4-5-20251001',
    model_sonnet text not null default 'claude-sonnet-4-20250514',
    model_opus text not null default 'claude-opus-4-6',
    model_codex text not null default 'gpt-5.3-codex',
    chat_model text not null default 'claude-sonnet-4-20250514',
    chat_max_tokens integer not null default 4096,
    chat_temperature numeric(3,2) not null default 0.20,
    tab_completion_enabled boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

comment on table public.user_settings is 'Synced extension settings per user';

-- ============================================================
-- 10. FEEDBACK (user ratings on pipeline outputs)
-- ============================================================
create table public.feedback (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles(id) on delete cascade,
    pipeline_run_id uuid references public.pipeline_runs(id) on delete set null,
    message_id uuid references public.messages(id) on delete set null,
    rating integer check (rating between 1 and 5),
    comment text,
    created_at timestamptz not null default now()
);

create index idx_feedback_user on public.feedback(user_id);
create index idx_feedback_pipeline on public.feedback(pipeline_run_id);

comment on table public.feedback is 'User ratings and feedback on AI outputs';

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.profiles enable row level security;
alter table public.api_keys enable row level security;
alter table public.sessions enable row level security;
alter table public.messages enable row level security;
alter table public.pipeline_runs enable row level security;
alter table public.pipeline_steps enable row level security;
alter table public.agent_usage enable row level security;
alter table public.cost_ledger enable row level security;
alter table public.user_settings enable row level security;
alter table public.feedback enable row level security;

-- Profiles: users can only read/update their own profile
create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);

-- API keys: users can only manage their own keys
create policy "api_keys_select_own" on public.api_keys for select using (auth.uid() = user_id);
create policy "api_keys_insert_own" on public.api_keys for insert with check (auth.uid() = user_id);
create policy "api_keys_update_own" on public.api_keys for update using (auth.uid() = user_id);
create policy "api_keys_delete_own" on public.api_keys for delete using (auth.uid() = user_id);

-- Sessions: users can only access their own sessions
create policy "sessions_select_own" on public.sessions for select using (auth.uid() = user_id);
create policy "sessions_insert_own" on public.sessions for insert with check (auth.uid() = user_id);
create policy "sessions_update_own" on public.sessions for update using (auth.uid() = user_id);
create policy "sessions_delete_own" on public.sessions for delete using (auth.uid() = user_id);

-- Messages: users can only access their own messages
create policy "messages_select_own" on public.messages for select using (auth.uid() = user_id);
create policy "messages_insert_own" on public.messages for insert with check (auth.uid() = user_id);

-- Pipeline runs: users can only access their own runs
create policy "pipeline_runs_select_own" on public.pipeline_runs for select using (auth.uid() = user_id);
create policy "pipeline_runs_insert_own" on public.pipeline_runs for insert with check (auth.uid() = user_id);
create policy "pipeline_runs_update_own" on public.pipeline_runs for update using (auth.uid() = user_id);

-- Pipeline steps: users can only access their own steps
create policy "pipeline_steps_select_own" on public.pipeline_steps for select using (auth.uid() = user_id);
create policy "pipeline_steps_insert_own" on public.pipeline_steps for insert with check (auth.uid() = user_id);
create policy "pipeline_steps_update_own" on public.pipeline_steps for update using (auth.uid() = user_id);

-- Agent usage: users can only access their own usage
create policy "agent_usage_select_own" on public.agent_usage for select using (auth.uid() = user_id);
create policy "agent_usage_insert_own" on public.agent_usage for insert with check (auth.uid() = user_id);
create policy "agent_usage_update_own" on public.agent_usage for update using (auth.uid() = user_id);

-- Cost ledger: users can only read their own ledger (immutable — no update/delete)
create policy "cost_ledger_select_own" on public.cost_ledger for select using (auth.uid() = user_id);
create policy "cost_ledger_insert_own" on public.cost_ledger for insert with check (auth.uid() = user_id);

-- User settings: users can only manage their own settings
create policy "user_settings_select_own" on public.user_settings for select using (auth.uid() = user_id);
create policy "user_settings_insert_own" on public.user_settings for insert with check (auth.uid() = user_id);
create policy "user_settings_update_own" on public.user_settings for update using (auth.uid() = user_id);

-- Feedback: users can only manage their own feedback
create policy "feedback_select_own" on public.feedback for select using (auth.uid() = user_id);
create policy "feedback_insert_own" on public.feedback for insert with check (auth.uid() = user_id);

-- ============================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================

-- Auto-update updated_at timestamp
create or replace function public.handle_updated_at()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql security definer;

create trigger profiles_updated_at before update on public.profiles
    for each row execute function public.handle_updated_at();
create trigger api_keys_updated_at before update on public.api_keys
    for each row execute function public.handle_updated_at();
create trigger sessions_updated_at before update on public.sessions
    for each row execute function public.handle_updated_at();
create trigger agent_usage_updated_at before update on public.agent_usage
    for each row execute function public.handle_updated_at();
create trigger user_settings_updated_at before update on public.user_settings
    for each row execute function public.handle_updated_at();

-- Auto-create profile on user signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
    insert into public.profiles (id, email, display_name)
    values (
        new.id,
        new.email,
        coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
    );

    insert into public.user_settings (user_id)
    values (new.id);

    return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created after insert on auth.users
    for each row execute function public.handle_new_user();

-- Increment session message count and cost on new message
create or replace function public.handle_new_message()
returns trigger as $$
begin
    update public.sessions
    set message_count = message_count + 1,
        total_input_tokens = total_input_tokens + new.input_tokens,
        total_output_tokens = total_output_tokens + new.output_tokens,
        total_cost_usd = total_cost_usd + new.cost_usd
    where id = new.session_id;
    return new;
end;
$$ language plpgsql security definer;

create trigger on_message_insert after insert on public.messages
    for each row execute function public.handle_new_message();

-- Update agent_usage aggregation on cost_ledger insert
create or replace function public.handle_cost_ledger_insert()
returns trigger as $$
begin
    insert into public.agent_usage (user_id, agent, period_start, period_end, request_count, total_input_tokens, total_output_tokens, total_cost_usd)
    values (
        new.user_id,
        new.agent,
        date_trunc('day', new.created_at)::date,
        (date_trunc('day', new.created_at) + interval '1 day')::date,
        1,
        new.input_tokens,
        new.output_tokens,
        new.cost_usd
    )
    on conflict (user_id, agent, period_start)
    do update set
        request_count = agent_usage.request_count + 1,
        total_input_tokens = agent_usage.total_input_tokens + new.input_tokens,
        total_output_tokens = agent_usage.total_output_tokens + new.output_tokens,
        total_cost_usd = agent_usage.total_cost_usd + new.cost_usd;
    return new;
end;
$$ language plpgsql security definer;

create trigger on_cost_ledger_insert after insert on public.cost_ledger
    for each row execute function public.handle_cost_ledger_insert();

-- ============================================================
-- VIEWS (for analytics)
-- ============================================================

-- Daily cost summary per user
create or replace view public.v_daily_costs as
select
    user_id,
    date_trunc('day', created_at)::date as day,
    agent,
    count(*) as requests,
    sum(input_tokens) as input_tokens,
    sum(output_tokens) as output_tokens,
    sum(cost_usd) as cost_usd
from public.cost_ledger
group by user_id, date_trunc('day', created_at)::date, agent
order by day desc, agent;

-- Pipeline success rate per task type
create or replace view public.v_pipeline_stats as
select
    user_id,
    task_type,
    count(*) as total_runs,
    count(*) filter (where status = 'completed') as completed,
    count(*) filter (where status = 'failed') as failed,
    count(*) filter (where review_approved = true) as approved,
    avg(duration_ms) as avg_duration_ms,
    sum(total_cost_usd) as total_cost_usd
from public.pipeline_runs
group by user_id, task_type;

-- Monthly cost per user (for billing)
create or replace view public.v_monthly_costs as
select
    user_id,
    date_trunc('month', created_at)::date as month,
    sum(cost_usd) as total_cost_usd,
    sum(input_tokens) as total_input_tokens,
    sum(output_tokens) as total_output_tokens,
    count(*) as total_requests
from public.cost_ledger
group by user_id, date_trunc('month', created_at)::date
order by month desc;
