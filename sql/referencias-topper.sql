-- Imagem de referência do topper + WhatsApp de quem faz os topos
-- Rode no Supabase: SQL Editor > New query > cole tudo > Run. Pode rodar mais de uma vez.
--
-- 1. Cria o bucket público "referencias" (Storage). No site, ao escolher um topper, o cliente
--    precisa enviar uma imagem de modelo; ela vai para esse bucket e o link entra na observação
--    do item ("Referência: <link>"). Só imagens, até 5 MB (o site já reduz a foto antes de enviar).
-- 2. Deixa qualquer visitante do site enviar (só para esse bucket; não dá para apagar nem trocar).
-- 3. Guarda nas configurações o WhatsApp de quem faz os topos de bolo (Ajustes > Loja).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('referencias', 'referencias', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "referencias: envio pelo site" on storage.objects;
create policy "referencias: envio pelo site" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'referencias');

-- a equipe pode apagar imagens de referência (ex.: trocar a imagem de um pedido)
drop policy if exists "referencias: equipe apaga" on storage.objects;
create policy "referencias: equipe apaga" on storage.objects
  for delete to authenticated
  using (bucket_id = 'referencias'
         and exists (select 1 from administradores a where a.user_id = auth.uid() and a.ativo));

alter table configuracoes add column if not exists whatsapp_topos text;
alter table configuracoes add column if not exists nome_topos text;
