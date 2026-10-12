-- Stories: imagens para os stories do Instagram e o status do WhatsApp (backoffice > Stories)
-- Rode no Supabase: SQL Editor > New query > cole tudo > Run. Pode rodar mais de uma vez.
--
-- 1. Cria o bucket público "stories" (Storage): a imagem pronta para postar (até 10 MB) e uma
--    miniatura para a grade. Público como as fotos do cardápio: quem tem o link vê (cada link tem
--    um código aleatório); enviar, ver a lista e apagar, só a Administração.
-- 2. Cria a tabela stories: título, pasta (ex.: "Promoções", "Datas especiais"), tamanho e quem enviou.
--    Só a Administração vê e mexe.

-- a mesma função de sql/estoque.sql e sql/topos.sql (aqui de novo para este script rodar sozinho)
create or replace function eh_admin_loja()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from administradores a where a.user_id = auth.uid() and a.ativo and a.papel = 'admin')
$$;
revoke all on function eh_admin_loja() from public;
grant execute on function eh_admin_loja() to authenticated;

-- ---------------------------------------------------------------- arquivos (Storage)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('stories', 'stories', true, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- apagar um arquivo também precisa "ver" o arquivo (sem isso o Storage não apaga e não avisa)
drop policy if exists "stories: administração vê" on storage.objects;
create policy "stories: administração vê" on storage.objects
  for select to authenticated
  using (bucket_id = 'stories' and eh_admin_loja());

drop policy if exists "stories: administração envia" on storage.objects;
create policy "stories: administração envia" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'stories' and eh_admin_loja());

drop policy if exists "stories: administração apaga" on storage.objects;
create policy "stories: administração apaga" on storage.objects
  for delete to authenticated
  using (bucket_id = 'stories' and eh_admin_loja());

-- ---------------------------------------------------------------- tabela
create table if not exists stories (
  id              uuid primary key default gen_random_uuid(),
  arquivo_path    text not null,                    -- a imagem para postar, no bucket "stories"
  miniatura_path  text,                             -- a versão pequena, para a grade
  titulo          text check (char_length(titulo) <= 120),
  pasta           text check (char_length(pasta) <= 60),
  largura         integer check (largura > 0),
  altura          integer check (altura > 0),
  bytes           integer check (bytes >= 0),
  criado_em       timestamptz not null default now(),
  criado_por      uuid default auth.uid()
);
create index if not exists stories_criado_idx on stories (criado_em desc);

alter table stories enable row level security;
drop policy if exists stories_administracao on stories;
create policy stories_administracao on stories
  for all to authenticated
  using (eh_admin_loja()) with check (eh_admin_loja());
