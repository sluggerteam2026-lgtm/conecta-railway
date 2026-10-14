# Conecta

Aplicação privada para uma turma de amigos, com canais de texto em tempo real, presença online e salas LiveKit para voz, câmera e compartilhamento de tela.

## Já configurado neste pacote

- Entrada apenas com nome/apelido + código da turma.
- Código padrão: `SLG2026`.
- Limite padrão: 20 pessoas conectadas.
- Canais de texto: `#geral`, `#jogos`, `#links-e-assuntos`.
- Salas de voz: `Sala da turma`, `Jogando juntos`, `Cinema & live`.
- Chat efêmero: as mensagens são transmitidas ao vivo e não são gravadas em banco de dados.
- LiveKit no backend: o API Secret nunca é enviado ao navegador.

## Rodar no Windows

1. Instale o Node.js LTS, caso ainda não tenha: https://nodejs.org
2. Dê dois cliques em `iniciar.bat`.
3. Na primeira execução, o Windows pode pedir autorização de rede para o Node.js. Permita em redes privadas.
4. O navegador abrirá em `http://localhost:3000`.

Para testar voz/vídeo entre duas pessoas, o servidor precisa estar acessível pelos dois computadores pela internet. `localhost` funciona apenas no próprio computador.

## Rodar pelo terminal

```bash
npm install
npm start
```

## Configuração

O arquivo `.env` contém as configurações privadas do servidor. **Não publique esse arquivo no GitHub e não mande o conteúdo dele em prints.**

Variáveis:

```env
PORT=3000
ACCESS_CODE=SLG2026
MAX_USERS=20
LIVEKIT_URL=wss://...
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
```

## Próximo passo: colocar online

Para seus amigos entrarem de casas diferentes, publique esta aplicação Node.js em um serviço que aceite WebSocket (por exemplo, Railway, Render, Fly.io ou um VPS). No serviço escolhido, cadastre as mesmas variáveis do `.env` como variáveis de ambiente. Depois disso, todos usam o mesmo endereço HTTPS.

## Segurança

A chave LiveKit fica exclusivamente no backend em `.env`. O frontend solicita ao servidor apenas um token temporário da sala de voz. O arquivo `.gitignore` já impede que `.env` e `node_modules` sejam enviados ao Git por engano.
