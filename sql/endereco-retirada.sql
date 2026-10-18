-- Endereço para retirada (Ajustes > Loja > Retirada)
-- Rode no Supabase: SQL Editor > New query > cole tudo > Run. Pode rodar mais de uma vez.
--
-- A mensagem de pedido confirmado (e a de pedido pronto para retirada) passa a dizer onde buscar,
-- com o link do Google Maps. O endereço é o que o cliente lê na mensagem; o "endereço de onde sai
-- a entrega" continua servindo para a taxa e, enquanto este ficar em branco, também para a retirada.

alter table configuracoes add column if not exists endereco_retirada text;

comment on column configuracoes.endereco_retirada is
  'Onde o cliente busca o pedido. Vai na mensagem de confirmação, com o link do mapa. Em branco: vale entrega_origem.';

notify pgrst, 'reload schema';
