-- Run this once in your Supabase project's SQL editor (Database → SQL Editor).

-- Tracks each user's plan. One row is created automatically when they sign up.
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz default now()
);

-- The URLs a user wants monitored.
create table if not exists monitors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  url text not null,
  is_up boolean default true,
  last_status_code int,
  last_checked_at timestamptz,
  created_at timestamptz default now()
);

-- Automatically create a free-plan profile row whenever someone signs up.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, plan)
  values (new.id, 'free');
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Row-level security: users can only ever see/edit their own data.
alter table profiles enable row level security;
alter table monitors enable row level security;

create policy "Users can view their own profile"
  on profiles for select
  using (auth.uid() = id);

create policy "Users can view their own monitors"
  on monitors for select
  using (auth.uid() = user_id);

create policy "Users can insert their own monitors"
  on monitors for insert
  with check (auth.uid() = user_id);

create policy "Users can delete their own monitors"
  on monitors for delete
  using (auth.uid() = user_id);
