import type { ChannelRow, ServerRow } from "./directory";

export const SEED_SERVERS: ServerRow[] = [
  { id: "cantinho", name: "Cantinho", initials: "C", color: "#5865f2", position: 0 },
  { id: "estudos", name: "Estudos", initials: "E", color: "#23a559", position: 1 },
  { id: "jogos", name: "Jogos", initials: "J", color: "#f0b132", position: 2 },
];

export const SEED_CHANNELS: ChannelRow[] = [
  { id: "c-boas-vindas", serverId: "cantinho", name: "boas-vindas", kind: "text", topic: "Chegou agora? Se apresenta.", position: 0 },
  { id: "c-geral", serverId: "cantinho", name: "geral", kind: "text", topic: "O papo do dia.", position: 1 },
  { id: "c-memes", serverId: "cantinho", name: "memes", kind: "text", topic: "Imagens, gifs e links.", position: 2 },
  { id: "c-links", serverId: "cantinho", name: "links", kind: "text", topic: "Coisas pra ver depois.", position: 3 },
  { id: "c-sala", serverId: "cantinho", name: "Sala", kind: "voice", topic: "Chamada principal.", position: 4 },
  { id: "c-jogatina", serverId: "cantinho", name: "Jogatina", kind: "voice", topic: "Pra jogar junto.", position: 5 },
  { id: "c-afk", serverId: "cantinho", name: "AFK", kind: "voice", topic: "Só escutando.", position: 6 },
  { id: "e-duvidas", serverId: "estudos", name: "duvidas", kind: "text", topic: "Pergunta sem vergonha.", position: 0 },
  { id: "e-materiais", serverId: "estudos", name: "materiais", kind: "text", topic: "Arquivos e links de estudo.", position: 1 },
  { id: "e-foco", serverId: "estudos", name: "Foco", kind: "voice", topic: "Microfone baixo, concentração alta.", position: 2 },
  { id: "j-lfg", serverId: "jogos", name: "lfg", kind: "text", topic: "Quem quer jogar?", position: 0 },
  { id: "j-clips", serverId: "jogos", name: "clips", kind: "text", topic: "Melhores momentos.", position: 1 },
  { id: "j-ranked", serverId: "jogos", name: "Ranked", kind: "voice", topic: "Partida séria.", position: 2 },
  { id: "j-casual", serverId: "jogos", name: "Casual", kind: "voice", topic: "Sem rank, com risada.", position: 3 },
];
