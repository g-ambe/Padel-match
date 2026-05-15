alter table matches
  add column if not exists completed boolean not null default false;

alter table player_stats
  add column if not exists loss_count int not null default 0;
