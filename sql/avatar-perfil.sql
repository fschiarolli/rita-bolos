-- Avatar do perfil da equipe (escolhido no backoffice em Minha conta > Trocar avatar)
-- Rode no Supabase: SQL Editor > New query > cole tudo > Run. Pode rodar mais de uma vez.
--
-- Guarda só o código do avatar (ex.: "a07"); os desenhos ficam no backoffice (backoffice/avatares.js).
-- Cada pessoa troca só o próprio avatar, pela função definir_avatar: ela não deixa mexer em
-- nome, acesso ou papel (isso continua só em Ajustes > Equipe, para a administração).

alter table administradores add column if not exists avatar text;

create or replace function definir_avatar(p_avatar text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_avatar is not null and p_avatar !~ '^[a-z0-9-]{1,40}$' then
    raise exception 'Avatar inválido.';
  end if;
  update administradores set avatar = nullif(p_avatar, '') where user_id = auth.uid() and ativo;
  if not found then
    raise exception 'Só a equipe pode escolher um avatar.';
  end if;
end;
$$;

revoke all on function definir_avatar(text) from public;
grant execute on function definir_avatar(text) to authenticated;
