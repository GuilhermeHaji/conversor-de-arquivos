# Conversor de arquivos

Plataforma web local para converter documentos, planilhas e apresentações com Node.js e LibreOffice.

## Sobre o projeto

Trocar arquivos entre ferramentas exige formatos diferentes: um documento editável para colaborar, um PDF para compartilhar ou um CSV para trabalhar com dados. Este projeto reúne essas conversões em uma página simples, com seleção de destino e download automático, executando o processamento no computador em que o servidor foi iniciado.

O backend Express usa o LibreOffice em modo headless e centraliza os pares permitidos em um mapa declarativo. Uma fila em memória limita a execução a duas conversões simultâneas para controlar o uso de CPU e memória. O frontend usa apenas HTML, CSS e JavaScript; o projeto não requer banco de dados, autenticação ou serviços externos.

Os uploads passam por validação de extensão, conteúdo real e tamanho antes de entrar na fila. Cada conversão recebe uma pasta com UUID e um perfil isolado do LibreOffice. O processo é iniciado sem shell, com argumentos separados, tem timeout e é cancelado quando o cliente desconecta. A limpeza dos arquivos temporários fica em `finally`, inclusive nos caminhos de erro.

## Funcionalidades

- Upload por seleção ou arrastar e soltar, com limite de 20 MB por arquivo.
- Destinos disponíveis conforme o formato de entrada, consultados na API.
- Validação do conteúdo real com `file-type`.
- Download automático, preservando o nome original com a nova extensão.
- Fila com até duas conversões ativas, dez aguardando e espera máxima de 90 segundos.
- Indicador de processamento e contador da fila atualizado a cada dois segundos.
- Timeout de 60 segundos por conversão e cancelamento por desconexão.
- Mensagens de erro do backend exibidas na interface.

### Conversões suportadas

| Entrada | Saídas permitidas |
| --- | --- |
| DOCX | PDF, ODT |
| ODT | PDF, DOCX |
| XLSX | PDF, CSV |
| PPTX | PDF |

PDF não é aceito como entrada. O mapa em `src/services/formats.js` é a fonte única dos pares permitidos, das extensões, dos MIME esperados e dos argumentos de exportação.

## Tecnologias

- Node.js 22 ou superior, com módulos ES.
- Express para o servidor HTTP e as rotas.
- LibreOffice headless como motor de conversão.
- multer para receber uploads multipart.
- file-type para identificar o formato pelo conteúdo.
- HTML, CSS e JavaScript puros no frontend.
- Runner de testes nativo do Node.js, sem framework adicional.

## Como rodar

### Pré-requisitos

- Node.js 22 ou superior, com npm.
- [LibreOffice](https://www.libreoffice.org/download/download-libreoffice/) instalado e o comando `soffice` disponível no PATH.

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

Abra **http://localhost:3000**. O servidor escuta apenas na interface local (`127.0.0.1`). Se o PowerShell bloquear `npm.ps1`, use `npm.cmd install` e `npm.cmd start`.

Ao iniciar, o servidor executa `soffice --headless --version`. Se o comando estiver ausente ou não puder ser executado, informa como instalar/configurar o LibreOffice e encerra com código 1, sem abrir a porta.

### Testes automatizados

```sh
npm test
```

Usam o runner nativo do Node e o fluxo HTTP real, com o processo do LibreOffice simulado. Cobrem os sete pares permitidos, `/formats`, destino ausente/inválido, validação de conteúdo, tamanho, nomes, saída com extensão incorreta ou vazia, erros, timeout e limpeza. Também verificam cinco conversões simultâneas com no máximo dois processos, fila cheia, espera excedida, cancelamento durante a espera e os contadores de `/status`. Não exigem LibreOffice e não verificam a fidelidade visual da conversão; use o teste manual acima para isso.

Referências: [multer](https://expressjs.com/en/resources/middleware/multer/), [file-type](https://github.com/sindresorhus/file-type) e [parâmetros do LibreOffice](https://help.libreoffice.org/latest/en-US/text/shared/guide/start_parameters.html).

### Teste manual

1. Inicie o servidor e abra **http://localhost:3000**.
2. **Texto — DOCX → ODT:** crie um documento com título, parágrafos, acentos e uma tabela. Salve como `relatório.docx`, selecione-o na página, escolha **ODT** e clique em **Converter para ODT**. Abra `relatório.odt` no Writer e confira o conteúdo.
3. **Planilha — XLSX → CSV:** crie uma planilha com cabeçalhos e algumas linhas, incluindo acentos e um texto com vírgula. Salve como `planilha.xlsx`, selecione **CSV** e clique em **Converter para CSV**. Abra `planilha.csv` em um editor ou importe-o no Calc como UTF-8, separado por vírgulas, com aspas como delimitador de texto. Confira os valores e as colunas.
4. **Apresentação — PPTX → PDF:** crie dois slides com títulos e textos e salve como `apresentação.pptx`. Selecione **PDF** e clique em **Converter para PDF**. Abra `apresentação.pdf` e confira se cada slide foi convertido em uma página legível.
5. Durante cada conversão, confira **Convertendo...**, o bloqueio dos controles e o download automático ao terminar. O seletor deve mostrar somente os destinos permitidos para o arquivo selecionado.
6. Após cada resposta, confirme que `tmp/` não contém pastas de conversão. A pasta raiz vazia pode permanecer.
7. Renomeie um arquivo de texto para uma extensão suportada e tente convertê-lo: o backend deve rejeitar o conteúdo com HTTP 400. A interface deve mostrar a mensagem recebida.
8. Tente um arquivo acima de 20 MB e um PDF como entrada; ambos devem ser rejeitados. Pela API, tente enviar um DOCX com `to=csv` e outra requisição sem `to`: ambas devem retornar 400.

CSV contém somente a primeira aba e os valores das células, sem a formatação visual da planilha. A exportação usa UTF-8, vírgulas e aspas duplas. Esse comportamento segue o [filtro CSV do LibreOffice](https://help.libreoffice.org/latest/en-US/text/shared/guide/csv_params.html).

Também é possível usar curl (no Windows, `curl.exe`):

```sh
curl --fail-with-body -F "file=@relatório.docx" -F "to=odt" http://localhost:3000/convert --output resultado.odt
curl --fail-with-body -F "file=@planilha.xlsx" -F "to=csv" http://localhost:3000/convert --output resultado.csv
curl --fail-with-body -F "file=@apresentação.pptx" -F "to=pdf" http://localhost:3000/convert --output resultado.pdf
```

O argumento `--output` escolhe o nome local do curl. O cabeçalho `Content-Disposition: attachment` contém o nome original com a extensão do destino. Acrescente `-D headers.txt` para inspecionar os cabeçalhos.

Exemplo de validação sem confiar no MIME declarado:

```sh
curl -i -F "file=@falso.docx;type=application/vnd.openxmlformats-officedocument.wordprocessingml.document" -F "to=pdf" http://localhost:3000/convert
```

Se `falso.docx` contiver texto ou outro formato, a resposta será 400 mesmo com o MIME de DOCX declarado.

## Arquitetura

```text
Upload → Validação → Fila → LibreOffice → Download → Limpeza
```

A rota recebe e valida o arquivo e o destino, grava o upload em uma pasta isolada e aguarda uma vaga na fila. O serviço de conversão executa o LibreOffice e verifica a saída. A rota envia o resultado e remove os temporários ao finalizar, inclusive quando há erro ou desconexão.

### Estrutura de pastas

```text
src/
  server.js
  routes/convert.js
  routes/formats.js
  routes/status.js
  services/converter.js
  services/formats.js
  services/queue.js
public/
  index.html
  style.css
  app.js
test/
  conversion.test.js
  queue.test.js
package.json
package-lock.json
.gitignore
README.md
LICENSE
```

### API e processamento

`GET /status` retorna os contadores atuais da fila, sem cache:

```json
{ "ativas": 2, "aguardando": 3, "limite": 2 }
```

Os números representam conversões em execução e requisições aguardando, não uploads ou downloads. Durante uma conversão, o frontend consulta essa rota a cada 2 segundos e mostra o total aguardando quando houver fila. A consulta para ao concluir ou falhar e não interfere na conversão se houver erro de rede.

`GET /formats` retorna o mapa completo em JSON, com as chaves `docx`, `odt`, `xlsx` e `pptx`. Cada entrada contém `extension`, `mime` e `outputs`. Exemplo do valor da chave `docx`:

```json
{
  "extension": "docx",
  "mime": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "outputs": ["pdf", "odt"]
}
```

O frontend consulta essa rota na inicialização e reutiliza a mesma promessa em cache ao selecionar arquivos. A lista de destinos e o atributo `accept` são derivados dessa resposta, sem duplicar o mapa no frontend. Uma consulta malsucedida pode ser repetida na próxima seleção.

`POST /convert` recebe `multipart/form-data` com:

- `file`: um único arquivo de até **20 MB (20 × 1024 × 1024 bytes)**. A extensão e o MIME detectado no conteúdo pelo `file-type` devem corresponder à mesma entrada do mapa.
- `to`: um único campo de texto obrigatório, com o destino em minúsculas, exatamente como retornado em `outputs` (`pdf`, `odt`, `docx` ou `csv`, conforme a entrada).

Respostas:

- **200:** arquivo para download, preservando o nome original com a extensão do destino.
- **400:** upload ausente ou inválido, extensão/conteúdo incompatíveis, tamanho excedido, `to` ausente ou destino não permitido. JSON `{ "error": "mensagem" }`.
- **500:** falha do motor, ausência do arquivo de saída esperado ou timeout. JSON no mesmo formato.
- **503:** fila cheia ou tempo de espera excedido. JSON `{ "error": "Servidor ocupado no momento. Tente novamente em instantes." }`.

O upload é recebido em memória, limitado a 20 MB por requisição. Após a validação, o arquivo é escrito em `tmp/<UUID>/<UUID>.<extensão_validada>`. O nome enviado pelo usuário serve apenas para nomear o download, removendo separadores e caracteres de controle.

A fila em `src/services/queue.js` inicia no máximo **2 conversões simultâneas** (`MAX_CONCURRENT`), aceita até **10 requisições aguardando** (`MAX_WAITING`) e limita a espera a **90 segundos** (`MAX_WAIT_MS`). Os trabalhos aguardam em ordem de chegada. Toda a validação acontece antes de entrar na fila; arquivos inválidos não ocupam vaga. A vaga é liberada após a conversão, inclusive em caso de erro, sem esperar pelo download.

Se o cliente desconectar enquanto aguarda, a entrada sai da fila e nunca inicia o LibreOffice. A limpeza no `finally` também cobre espera excedida e fila cheia. A fila existe somente na memória deste processo Node, não persiste após reinicialização e não coordena múltiplos servidores. Os 90 segundos de espera são separados do timeout de 60 segundos da conversão.

Para testar a fila manualmente, abra quatro abas da página, escolha um documento em cada uma e inicie as quatro conversões em sequência rápida. Durante a sobreposição, `/status` deve mostrar no máximo duas ativas, e as páginas devem exibir o total na fila. Feche uma aba que esteja aguardando para verificar a remoção da entrada. Ao terminar todas as conversões, os contadores devem voltar a zero e `tmp/` ficar vazia. Se os arquivos converterem muito rápido, use documentos maiores, sempre respeitando 20 MB.

O serviço usa `spawn` com argumentos em array e `shell: false`, com o equivalente a:

```sh
soffice -env:UserInstallation=<URL_do_perfil_temporário> --headless --convert-to <destino_e_filtro> --outdir <pasta_temporária> <arquivo>
```

Cada conversão tem perfil próprio. Após 60 segundos, o serviço encerra a árvore do processo e retorna 500. No Windows usa `taskkill /T /F`; em sistemas POSIX encerra o grupo de processos. O cliente desconectado também cancela a conversão.

O serviço expõe `convert(inputPath, outputDir, targetFormat, { signal } = {})`. O quarto argumento opcional mantém o cancelamento por desconexão. O destino é validado pelo mapa antes de executar o processo, e a saída deve existir com a extensão esperada e tamanho maior que zero.

A limpeza fica em `finally`, depois que o processo termina e que o envio do arquivo conclui ou falha. Remove original, saída e perfil em sucesso, erro, timeout e desconexão. Uploads incompletos ou rejeitados não chegam a criar arquivos no disco. Interrupção forçada do Node ou desligamento da máquina não executam `finally`.

## Roadmap

- Adicionar novos formatos de entrada e saída.
- Suportar conversão de arquivos em lote.
- Preparar uma versão para deploy.

Esses itens são próximos passos; a versão atual roda localmente e recebe um arquivo por requisição.

## Licença

Distribuído sob a licença [MIT](LICENSE). Copyright © 2026 Guilherme Haji.

## Demonstração

**Placeholder:** adicione uma captura real da interface em `docs/screenshot.png` e inclua-a nesta seção. Nenhuma imagem de demonstração foi adicionada ainda.
