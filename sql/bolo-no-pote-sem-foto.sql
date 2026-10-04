-- Bolo no pote sem foto: todos usam o desenho padrão do site
-- Rode no Supabase: SQL Editor > New query > cole tudo > Run. Pode rodar mais de uma vez.
--
-- O site já ignora essas fotos; isto limpa o cadastro para o backoffice também não mostrar.
-- O resultado lista os arquivos que estavam cadastrados. Eles continuam no Storage
-- (o Supabase não deixa apagar arquivo por SQL): Storage > cardapio > selecione esses arquivos > Delete.

with potes as (
  select p.id, p.nome, p.imagem_path
  from produtos p
  join categorias c on c.id = p.categoria_id
  where (c.icone = 'pote' or c.slug = 'bolo-no-pote')
    and p.imagem_path is not null
), limpos as (
  update produtos set imagem_path = null
  where id in (select id from potes)
  returning id
)
select potes.nome, potes.imagem_path as arquivo_para_apagar_no_storage
from potes join limpos using (id)
order by potes.nome;

-- Se não voltar nenhuma linha, já estava tudo limpo.
