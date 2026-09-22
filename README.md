# Conversor de arquivos

Plataforma web para converter documentos, planilhas, apresentações e vídeos, e para compactar arquivos em ZIP. Feita com Node.js, LibreOffice e FFmpeg. Roda no seu computador ou publicada na internet, com HTTPS, em um servidor gratuito da Oracle Cloud.

![Interface do conversor com um vídeo selecionado e o destino "MP4 compactado" escolhido](docs/screenshot.png)

## Sobre o projeto

Trocar arquivos entre ferramentas exige formatos diferentes: um documento editável para colaborar, um PDF para compartilhar, um CSV para trabalhar com dados, um vídeo menor para enviar por mensagem. Este projeto reúne essas conversões em uma página simples, com seleção de destino e download automático, executando todo o processamento no próprio servidor, sem serviços externos.

O backend Express usa dois motores: o LibreOffice em modo headless para documentos e o FFmpeg para vídeos. Um mapa declarativo define as famílias de arquivo, os pares permitidos, os limites de tamanho e os tempos máximos de cada uma. Uma fila em memória limita a execução a duas tarefas simultâneas para controlar o uso de CPU e memória. O frontend usa apenas HTML, CSS e JavaScript; o projeto não requer banco de dados, autenticação ou serviços externos.

Os uploads vão direto para uma pasta temporária exclusiva da requisição e passam por validação de extensão, tamanho e conteúdo real antes de entrar na fila. Os motores são iniciados sem shell, com argumentos separados, têm timeout e são cancelados quando o cliente desconecta. No FFmpeg, o leitor de entrada é forçado de acordo com a extensão validada e só arquivos locais podem ser lidos. A limpeza dos temporários fica em `finally`, inclusive nos caminhos de erro.

## Funcionalidades

- Upload por seleção ou arrastar e soltar, com barra de progresso do envio.
- Destinos disponíveis conforme o formato de entrada, consultados na API.
- Vários arquivos de uma vez (ou qualquer arquivo sem conversão disponível) viram um ZIP.
- Limite de tamanho por tipo: documentos até 20 MB, vídeos até 500 MB, ZIP até 20 arquivos e 200 MB no total.
- Validação do conteúdo real com `file-type` (e de texto UTF-8 para CSV).
- Download automático, preservando o nome original com a nova extensão.
- Fila com até duas tarefas ativas e dez aguardando, com contador na interface.
- Timeout de 60 segundos para documentos e 15 minutos para vídeos; cancelamento por desconexão.
- Se um motor não estiver instalado, só a família dele fica indisponível; o resto continua funcionando.
- Pronto para uso público: limite de conversões por visitante, cabeçalhos de segurança, página de privacidade (LGPD) e HTTPS automático com Caddy.

### Conversões suportadas

| Entrada | Saídas |
| --- | --- |
| DOCX | PDF, ODT, TXT, HTML |
| ODT | PDF, DOCX, TXT |
| XLSX | PDF, CSV, ODS |
| ODS | XLSX, PDF, CSV |
| CSV | XLSX, ODS, PDF |
| PPTX | PDF, ODP |
| ODP | PPTX, PDF |
| MP4 | MP4 compactado, WEBM, GIF, MOV |
| MOV | MP4, MP4 compactado, WEBM, GIF |
| WEBM | MP4, MP4 compactado, GIF |
| MKV | MP4, MP4 compactado, WEBM, GIF |
| AVI | MP4, MP4 compactado, WEBM, GIF |
| Qualquer arquivo (um ou vários) | ZIP |

Detalhes das saídas de vídeo:

- **MP4**: H.264 + AAC, otimizado para reprodução na web (`+faststart`).
- **MP4 compactado**: reduz a resolução para no máximo 1280 px de largura e aumenta a compressão. Num teste com um vídeo de 20,8 MB em 1080p, o resultado teve 1,3 MB.
- **WEBM**: VP9 + Opus.
- **GIF**: primeiros 15 segundos, 10 quadros por segundo, 480 px de largura, com paleta de cores otimizada.

CSV contém somente a primeira aba e os valores das células, em UTF-8, separado por vírgulas. HTML gerado a partir de DOCX traz as imagens embutidas no próprio arquivo.

O mapa em `src/services/formats.js` é a fonte única das famílias, dos pares permitidos, dos limites e dos argumentos de cada motor.

## Tecnologias

- Node.js 22 ou superior, com módulos ES.
- Express para o servidor HTTP e as rotas.
- LibreOffice headless como motor de documentos.
- FFmpeg como motor de vídeo, instalado automaticamente pelo pacote `ffmpeg-static`.
- multer para receber uploads multipart direto em disco.
- file-type para identificar o formato pelo conteúdo.
- yazl para gerar arquivos ZIP.
- HTML, CSS e JavaScript puros no frontend.
- Runner de testes nativo do Node.js, sem framework adicional.

## Como rodar

### Pré-requisitos

- Node.js 22 ou superior, com npm.
- [LibreOffice](https://www.libreoffice.org/download/download-libreoffice/) instalado e o comando `soffice` disponível no PATH (necessário só para documentos).

O FFmpeg não precisa ser instalado: o `npm install` baixa um binário pronto para o seu sistema. Para usar outro FFmpeg, defina a variável `FFMPEG_PATH`.

Confirme no mesmo terminal em que iniciará o projeto:

```sh
node --version
soffice --version
```

No Windows, se a instalação estiver no local padrão, adicione a pasta ao PATH desta sessão do PowerShell:

```powershell
$env:Path += ';C:\Program Files\LibreOffice\program'
soffice --version
```

No macOS, a instalação padrão pode ser disponibilizada nesta sessão com:

```sh
export PATH="/Applications/LibreOffice.app/Contents/MacOS:$PATH"
```

No Linux, instale o LibreOffice incluindo os componentes Writer, Calc e Impress pelo gerenciador de pacotes da distribuição. As fontes disponíveis na máquina influenciam a aparência do PDF.

### Instalação e execução

No diretório do projeto:

```sh
npm install
npm start
```

Abra **http://localhost:3000**. Por padrão o servidor escuta apenas na interface local (`127.0.0.1`); as variáveis de ambiente `HOST` e `PORT` alteram isso quando necessário. Se o PowerShell bloquear `npm.ps1`, use `npm.cmd install` e `npm.cmd start`.

Ao iniciar, o servidor verifica os dois motores e mostra o resultado no terminal. Se um deles faltar, a família correspondente some da página e o restante continua disponível. Se nenhum estiver disponível, o servidor encerra com código 1.

### Docker

Para rodar sem instalar Node ou LibreOffice na máquina, a imagem já inclui os dois (e o FFmpeg):

```sh
docker build -t conversor-de-arquivos .
docker run --rm -p 3000:3000 conversor-de-arquivos
```

A imagem parte de `node:22-bookworm-slim`, instala apenas Writer, Calc e Impress, roda como usuário sem privilégios e expõe a porta 3000 com `HOST=0.0.0.0`. Um `HEALTHCHECK` consulta `/status` a cada 30 segundos.

### Configuração

Todos os limites vêm de variáveis de ambiente. Os padrões valem para uso local; o `docker-compose.yml` de produção define valores menores para o público.

| Variável | Local (padrão) | Produção | O que controla |
| --- | --- | --- | --- |
| `MAX_DOC_MB` | 20 | 20 | Tamanho máximo de documentos |
| `MAX_VIDEO_MB` | 500 | 100 | Tamanho máximo de vídeos |
| `ZIP_MAX_MB` / `ZIP_MAX_FILES` | 200 / 20 | 100 / 20 | Limites da compactação em ZIP |
| `MAX_CONCURRENT` | 2 | 2 | Tarefas executando ao mesmo tempo no servidor |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MIN` | desligado / 10 | 60 / 10 | Conversões por visitante numa janela de minutos |
| `MAX_ACTIVE_PER_IP` | desligado | 2 | Conversões simultâneas por visitante |
| `TRUST_PROXY` | 0 | 1 | Proxies confiáveis na frente do servidor (para identificar o IP real) |
| `HOST` / `PORT` | 127.0.0.1 / 3000 | 0.0.0.0 / 3000 | Endereço e porta do servidor |

Um valor inválido (por exemplo, `MAX_VIDEO_MB=cem`) impede o servidor de iniciar, com uma mensagem indicando a variável.

### Publicação na internet

O guia completo, passo a passo, está em **[DEPLOY.md](DEPLOY.md)**: criar o servidor gratuito na Oracle Cloud, apontar o domínio no Registro.br e instalar tudo com um comando:

```bash
curl -fsSL https://raw.githubusercontent.com/GuilhermeHaji/conversor-de-arquivos/main/deploy/instalar.sh | bash -s -- seudominio.com.br
```

Em produção, o `docker-compose.yml` sobe dois containers: o **Caddy**, que atende nas portas 80 e 443 e obtém e renova o certificado HTTPS sozinho, e o **conversor**, acessível apenas pelo Caddy. Para atualizar o site depois de mudanças no GitHub: `bash ~/conversor-de-arquivos/deploy/atualizar.sh`.

### Testes automatizados

```sh
npm test
```

Os testes também rodam automaticamente no GitHub Actions a cada push e pull request, em Linux e Windows (`.github/workflows/testes.yml`).

São 100 testes com o runner nativo do Node e o fluxo HTTP real, com os processos do LibreOffice e do FFmpeg simulados. Cobrem todos os pares de conversão, `/formats`, os argumentos passados a cada motor (incluindo o leitor forçado do FFmpeg), limites por tipo, recusa antecipada pelo `Content-Length`, validação de conteúdo (incluindo CSV binário e playlist disfarçada de vídeo), nomes maliciosos, ZIP com nomes duplicados, erros, timeouts de 60 segundos e 15 minutos, desconexões, fila, limpeza dos temporários, limite por visitante, cabeçalhos de segurança e leitura da configuração. Não exigem LibreOffice nem FFmpeg e não verificam a fidelidade visual das conversões; use o teste manual abaixo para isso.

### Teste manual

1. Inicie o servidor e abra **http://localhost:3000**.
2. **Documento:** selecione um DOCX, escolha **PDF** ou **TXT** e converta. Confira o arquivo baixado.
3. **Planilha:** selecione um CSV e converta para **XLSX**. Abra no Excel ou Calc e confira colunas e acentos.
4. **Apresentação:** converta um PPTX para **PDF** e confira uma página por slide.
5. **Vídeo:** selecione um MP4 do celular e escolha **MP4 compactado**. Acompanhe a barra de envio e depois o "Convertendo...". Compare o tamanho do arquivo baixado com o original. Teste também **GIF**.
6. **ZIP:** selecione três arquivos de tipos diferentes de uma vez. A única opção deve ser **ZIP**. Abra o ZIP e confira os arquivos.
7. **Validação:** renomeie um arquivo de texto para `.mp4` e tente converter. A página deve mostrar que o conteúdo não corresponde ao formato.
8. **Fila:** abra três abas e inicie conversões de vídeo quase ao mesmo tempo. A terceira deve mostrar "(1 na fila)".
9. Após cada teste, confirme que a pasta `tmp/` não contém pastas de conversão.

## Arquitetura

```text
Upload (disco) → Validação → Fila → LibreOffice ou FFmpeg → Download → Limpeza
                                   → ZIP (yazl)
```

A rota cria uma pasta com UUID para a requisição e grava o upload nela, com nome gerado pelo servidor. Depois valida extensão, tamanho, destino e conteúdo, e só então aguarda uma vaga na fila. O serviço de conversão escolhe o motor pela família do arquivo e verifica a saída. A rota envia o resultado e remove a pasta ao finalizar, inclusive quando há erro ou desconexão.

### Estrutura de pastas

```text
src/
  server.js              inicialização, verificação dos motores e limpeza de sobras
  app.js                 montagem da aplicação (rotas, proteções, arquivos estáticos)
  routes/convert.js      POST /convert
  routes/zip.js          POST /zip
  routes/formats.js      GET /formats
  routes/status.js       GET /status
  services/formats.js    mapa de famílias, entradas, destinos e limites
  services/converter.js  execução do LibreOffice e do FFmpeg
  services/queue.js      fila em memória
  services/uploads.js    upload em disco, temporários e nomes seguros
  services/config.js     limites lidos das variáveis de ambiente
  services/protection.js limite por visitante e cabeçalhos de segurança
public/
  index.html
  privacidade.html       privacidade e termos de uso (LGPD)
  style.css
  app.js
test/
  conversion.test.js
  queue.test.js
  protection.test.js
docs/
  screenshot.png
.github/workflows/
  testes.yml
deploy/
  Caddyfile              HTTPS automático e limite de upload
  instalar.sh            instalação no servidor com um comando
  atualizar.sh           atualização a partir do GitHub
docker-compose.yml       produção: conversor + Caddy
DEPLOY.md                guia de publicação na Oracle Cloud
.env.example
Dockerfile
.dockerignore
package.json
package-lock.json
.gitignore
README.md
LICENSE
```

### API

`GET /formats` retorna os formatos disponíveis nesta máquina e os limites do ZIP:

```json
{
  "formatos": {
    "mp4": {
      "extension": "mp4",
      "family": "video",
      "maxBytes": 524288000,
      "outputs": [
        { "id": "mp4-compacto", "label": "MP4 compactado (menor)", "extension": "mp4" },
        { "id": "gif", "label": "GIF animado (primeiros 15 s)", "extension": "gif" }
      ]
    }
  },
  "zip": { "maxFiles": 20, "maxTotalBytes": 209715200 }
}
```

O frontend monta a lista de destinos, os textos de limite e as verificações de tamanho a partir dessa resposta, sem duplicar o mapa.

`POST /convert` recebe `multipart/form-data` com:

- `file`: um único arquivo. A extensão e o conteúdo detectado devem corresponder à mesma entrada do mapa, e o tamanho deve respeitar o limite da família.
- `to`: um único campo de texto com o `id` do destino, exatamente como retornado em `outputs`.

`POST /zip` recebe `multipart/form-data` com um ou mais arquivos no campo `files` (até 20, somando até 200 MB). Os nomes das entradas do ZIP vêm dos nomes originais sem pastas nem caracteres proibidos; nomes repetidos recebem um sufixo como `foto (2).jpg`. Com um arquivo, o download se chama `<nome>.zip`; com vários, `arquivos.zip`.

`GET /status` retorna os contadores atuais da fila, sem cache:

```json
{ "ativas": 2, "aguardando": 3, "limite": 2 }
```

Respostas de `/convert` e `/zip`:

- **200:** arquivo para download.
- **400:** upload ausente ou inválido, formato não suportado, tamanho excedido, destino ausente ou não permitido, conteúdo incompatível. JSON `{ "error": "mensagem" }`. Quando o `Content-Length` já indica um upload acima do limite, a recusa acontece antes de receber o corpo.
- **500:** falha do motor, ausência do arquivo de saída ou timeout. JSON no mesmo formato.
- **429:** limite de conversões por visitante atingido (só quando ligado).
- **503:** fila cheia ou tempo de espera excedido. JSON `{ "error": "Servidor ocupado no momento. Tente novamente em instantes." }`.

### Processamento e segurança

A fila em `src/services/queue.js` inicia no máximo **2 tarefas simultâneas** (`MAX_CONCURRENT`), aceita até **10 aguardando** (`MAX_WAITING`) e limita a espera a **10 minutos** (`MAX_WAIT_MS`), para comportar vídeos longos. Os trabalhos aguardam em ordem de chegada; arquivos inválidos são recusados antes de ocupar vaga. Se o cliente desconectar enquanto aguarda, a entrada sai da fila e o motor nunca é iniciado. A fila existe somente na memória deste processo Node.

O LibreOffice é executado com o equivalente a:

```sh
soffice -env:UserInstallation=<perfil_temporário> --headless [--infilter=CSV:44,34,76,1] --convert-to <filtro> --outdir <pasta_temporária> <arquivo>
```

Cada conversão tem perfil próprio, o que permite duas conversões simultâneas sem conflito.

O FFmpeg é executado com o equivalente a:

```sh
ffmpeg -hide_banner -nostdin -loglevel error -y -protocol_whitelist file -f <leitor> -i <arquivo> <argumentos_do_destino> <pasta_temporária>/saida.<extensão>
```

O `-f` força o leitor correspondente à extensão validada (`mov` para MP4/MOV, `matroska` para WEBM/MKV, `avi` para AVI). Isso impede que um arquivo manipulado faça o FFmpeg usar outro leitor, como o de playlists, para acessar a rede ou outros arquivos do computador. O `-protocol_whitelist file` reforça que apenas arquivos locais podem ser abertos.

Ambos os motores são iniciados com `spawn`, argumentos em array e `shell: false`. No timeout, o serviço encerra a árvore do processo (`taskkill /T /F` no Windows, grupo de processos em sistemas POSIX) e retorna 500. A saída deve existir com a extensão esperada e tamanho maior que zero.

Para uso público, cada visitante (identificado pelo IP) tem um limite de conversões numa janela de tempo e de conversões simultâneas; acima disso, a resposta é **429** com uma mensagem explicando. Atrás do Caddy, o IP vem do cabeçalho `X-Forwarded-For`, que o Caddy reescreve, então um visitante não consegue se passar por outro. Todas as páginas saem com uma política de segurança de conteúdo (CSP) que só permite recursos do próprio site, além de `X-Frame-Options`, `nosniff` e `Referrer-Policy`. Ao iniciar, o servidor apaga pastas temporárias que tenham sobrado de uma queda anterior.

A limpeza fica em `finally`, depois que o processo termina e que o envio do arquivo conclui ou falha. Remove upload, saída e perfil em sucesso, erro, timeout e desconexão, inclusive quando o upload é interrompido no meio. Interrupção forçada do Node ou desligamento da máquina não executam `finally`.

## Roadmap

- Imagens (JPG, PNG, WEBP) com redimensionamento e compressão.
- Áudio (MP3, WAV, OGG) e extração do áudio de vídeos.
- Extrair ZIP e converter os arquivos de dentro em lote.
- PDF como formato de entrada (PDF → DOCX).
- Publicação automática no servidor a cada commit (GitHub Actions + SSH).

## Licença

Distribuído sob a licença [MIT](LICENSE). Copyright © 2026 Guilherme Haji.
