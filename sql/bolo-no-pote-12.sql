-- Bolo no pote: todos os sabores passam a custar R$ 12,00
-- Rode no Supabase: SQL Editor > New query > cole tudo > Run. Pode rodar mais de uma vez.
--
-- Muda o preço dos produtos da categoria "Bolo no pote" e os textos que citam o valor:
-- a apresentação da categoria e o banner da página inicial que leva ao bolo no pote.
-- Pedidos já feitos não mudam: cada pedido guarda o preço do momento em que foi feito.

begin;

update produtos set preco = 12.00
where categoria_id in (select id from categorias where slug = 'bolo-no-pote')
  and preco <> 12.00;

update categorias set introducao = replace(introducao, 'R$ 15,00', 'R$ 12,00')
where slug = 'bolo-no-pote' and introducao like '%R$ 15,00%';

update banners set subtitulo = replace(subtitulo, 'R$ 15,00', 'R$ 12,00')
where link = '#cardapio/bolo-no-pote' and subtitulo like '%R$ 15,00%';

commit;

-- Conferir:
-- select nome, preco from produtos
-- where categoria_id in (select id from categorias where slug = 'bolo-no-pote') order by nome;
