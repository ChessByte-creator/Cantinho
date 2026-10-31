-- Estrutura compartilhada do Cantinho (servidores e canais).
-- Sem dados de pessoas: mensagens e perfis ficam só no navegador, ao vivo.

create table if not exists servers (
  id text primary key,
  name text not null,
  initials text not null,
  color text not null,
  position integer not null
);

create table if not exists channels (
  id text primary key,
  server_id text not null references servers (id),
  name text not null,
  kind text not null check (kind in ('text', 'voice')),
  topic text not null default '',
  position integer not null
);

create index if not exists channels_server_idx on channels (server_id, position);

insert into servers (id, name, initials, color, position) values
  ('cantinho', 'Cantinho', 'C', '#5865f2', 0),
  ('estudos', 'Estudos', 'E', '#23a559', 1),
  ('jogos', 'Jogos', 'J', '#f0b132', 2)
on conflict (id) do nothing;

insert into channels (id, server_id, name, kind, topic, position) values
  ('c-boas-vindas', 'cantinho', 'boas-vindas', 'text', 'Chegou agora? Se apresenta.', 0),
  ('c-geral', 'cantinho', 'geral', 'text', 'O papo do dia.', 1),
  ('c-memes', 'cantinho', 'memes', 'text', 'Imagens, gifs e links.', 2),
  ('c-links', 'cantinho', 'links', 'text', 'Coisas pra ver depois.', 3),
  ('c-sala', 'cantinho', 'Sala', 'voice', 'Chamada principal.', 4),
  ('c-jogatina', 'cantinho', 'Jogatina', 'voice', 'Pra jogar junto.', 5),
  ('c-afk', 'cantinho', 'AFK', 'voice', 'Só escutando.', 6),
  ('e-duvidas', 'estudos', 'duvidas', 'text', 'Pergunta sem vergonha.', 0),
  ('e-materiais', 'estudos', 'materiais', 'text', 'Arquivos e links de estudo.', 1),
  ('e-foco', 'estudos', 'Foco', 'voice', 'Microfone baixo, concentração alta.', 2),
  ('j-lfg', 'jogos', 'lfg', 'text', 'Quem quer jogar?', 0),
  ('j-clips', 'jogos', 'clips', 'text', 'Melhores momentos.', 1),
  ('j-ranked', 'jogos', 'Ranked', 'voice', 'Partida séria.', 2),
  ('j-casual', 'jogos', 'Casual', 'voice', 'Sem rank, com risada.', 3)
on conflict (id) do nothing;
