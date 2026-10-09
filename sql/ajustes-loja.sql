-- Pix e horários de retirada em Ajustes > Loja
-- Rode no Supabase: SQL Editor > New query > cole tudo > Run. Pode rodar mais de uma vez.
--
-- Antes, a chave Pix e os horários de retirada (8h às 18h, de 30 em 30 minutos) estavam escritos
-- no código, repetidos no site, na página do atacado, no recibo e nas mensagens. Agora ficam nas
-- configurações e a equipe muda em Ajustes > Loja. O site lê pelo cardápio (obter_cardapio já
-- devolve todos os campos das configurações), sem mexer em nenhuma função.
--
-- 1. Pix do sinal: chave, tipo (CPF, CNPJ, celular...) e nome de quem recebe. Na primeira vez,
--    entra o Pix que estava no código. Chave em branco: o Pix deixa de aparecer.
-- 2. Retirada no site: primeiro e último horário oferecidos, intervalo entre eles e quantos dias
--    aparecem para escolher. O cliente ainda pode digitar outro horário.

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'configuracoes' and column_name = 'pix_chave') then
    alter table configuracoes add column if not exists pix_chave text,
                              add column if not exists pix_tipo text,
                              add column if not exists pix_nome text;
    update configuracoes set pix_chave = '06954518808', pix_tipo = 'CPF', pix_nome = 'Valdemir Schiarolli';
  end if;
end $$;

alter table configuracoes add column if not exists retirada_inicio time not null default '08:00';
alter table configuracoes add column if not exists retirada_fim time not null default '18:00';
alter table configuracoes add column if not exists retirada_intervalo_min integer not null default 30;
alter table configuracoes add column if not exists retirada_dias integer not null default 14;

alter table configuracoes drop constraint if exists configuracoes_retirada_ck;
alter table configuracoes add constraint configuracoes_retirada_ck check (
  retirada_fim > retirada_inicio
  and retirada_intervalo_min between 5 and 240
  and retirada_dias between 1 and 60);
