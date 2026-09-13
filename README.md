# Conversor local DOCX → PDF

MVP com Node.js, Express, multer, file-type e uma página HTML/CSS/JS sem framework. Executa apenas DOCX → PDF usando LibreOffice headless. Sem fila, banco de dados, autenticação ou deploy.

## Pré-requisitos

- Node.js 22 ou superior, com npm.
- [LibreOffice](https://www.libreoffice.org/download/download-libreoffice/) instalado e o comando `soffice` disponível no PATH.

Confirme no mesmo terminal em que iniciará o projeto:

Neste computador, o LibreOffice já foi instalado localmente em `C:\Users\guilh\Documents\Codex\tools\LibreOffice`, e a subpasta `program` foi adicionada ao PATH do usuário. As dependências Node também já estão instaladas. A conversão real foi validada pelo endpoint, incluindo o nome do download e a limpeza dos temporários.

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

No Linux, instale o LibreOffice incluindo o componente Writer pelo gerenciador de pacotes da distribuição. As fontes disponíveis na máquina influenciam a aparência do PDF.

## Instalar e rodar

No diretório do projeto:

```sh
npm install
npm start
```

Abra **http://localhost:3000**. O servidor escuta apenas na interface local (`127.0.0.1`). Se o PowerShell bloquear `npm.ps1`, use `npm.cmd install` e `npm.cmd start`.

Ao iniciar, o servidor executa `soffice --headless --version`. Se o comando estiver ausente ou não puder ser executado, informa como instalar/configurar o LibreOffice e encerra com código 1, sem abrir a porta.

## Testar manualmente

1. Crie no Word ou no LibreOffice Writer um documento com título, parágrafos e uma tabela; salve como `relatório.docx`.
2. Na página, selecione esse arquivo pelo botão ou arraste-o até a área indicada.
3. Clique em **Converter para PDF**. Durante a requisição, a página mostra **Convertendo...** e bloqueia novas seleções.
4. Confirme o download automático de `relatório.pdf` e abra-o para verificar o conteúdo e a formatação.
5. Após o término, confira que `tmp/` não contém pastas de conversão. A pasta raiz vazia pode permanecer.
6. Renomeie um arquivo de texto para `.docx` e tente convertê-lo: o backend deve rejeitar o conteúdo com HTTP 400. A interface deve mostrar a mensagem recebida.
7. Tente selecionar outro formato ou um arquivo acima de 20 MB. Para verificar a validação diretamente no backend, envie-os com o comando abaixo.

Também é possível usar curl (no Windows, `curl.exe`):

```sh
curl --fail-with-body -D headers.txt -F "file=@relatório.docx" http://localhost:3000/convert --output resultado.pdf
```

O argumento `--output` escolhe o nome local do curl. O cabeçalho salvo em `headers.txt` contém `Content-Disposition: attachment` com o nome original e extensão `.pdf`.

Exemplo de validação sem confiar no MIME declarado:

```sh
curl -i -F "file=@falso.docx;type=application/vnd.openxmlformats-officedocument.wordprocessingml.document" http://localhost:3000/convert
```

Se `falso.docx` contiver texto ou outro formato, a resposta será 400 mesmo com o MIME de DOCX declarado.

## API e processamento

`POST /convert` recebe `multipart/form-data` com um único arquivo no campo `file`, de até **20 MB (20 × 1024 × 1024 bytes)**. Requer extensão `.docx` e identificação do conteúdo pelo `file-type` com MIME `application/vnd.openxmlformats-officedocument.wordprocessingml.document`.

- **200:** PDF para download, preservando o nome original com extensão `.pdf`.
- **400:** upload ausente, inválido, formato incorreto ou tamanho excedido. JSON `{ "error": "mensagem" }`.
- **500:** falha do motor, ausência de PDF ou timeout. JSON no mesmo formato.

O upload é recebido em memória, limitado a 20 MB por requisição. Após a validação, o arquivo é escrito em `tmp/<UUID>/<UUID>.docx`. O nome enviado pelo usuário serve apenas para nomear o download, removendo separadores e caracteres de controle.

O serviço usa `spawn` com argumentos em array e `shell: false`, com o equivalente a:

```sh
soffice -env:UserInstallation=<URL_do_perfil_temporário> --headless --convert-to pdf --outdir <pasta_temporária> <arquivo.docx>
```

Cada conversão tem perfil próprio. Após 60 segundos, o serviço encerra a árvore do processo e retorna 500. No Windows usa `taskkill /T /F`; em sistemas POSIX encerra o grupo de processos. O cliente desconectado também cancela a conversão.

A limpeza fica em `finally`, depois que o processo termina e que o envio do PDF conclui ou falha. Remove original, PDF e perfil em sucesso, erro, timeout e desconexão. Uploads incompletos ou rejeitados não chegam a criar arquivos no disco. Interrupção forçada do Node ou desligamento da máquina não executam `finally`.

## Estrutura

```text
src/
  server.js
  routes/convert.js
  services/converter.js
public/
  index.html
  style.css
  app.js
test/
  conversion.test.js
package.json
package-lock.json
.gitignore
README.md
```

## Testes automatizados

```sh
npm test
```

Usam o runner nativo do Node e o fluxo HTTP real, com o processo do LibreOffice simulado. Cobrem validação de conteúdo, tamanho, nomes, erros, timeout e limpeza. Não exigem LibreOffice e não verificam a fidelidade visual da conversão; use o teste manual acima para isso.

Referências: [multer](https://expressjs.com/en/resources/middleware/multer/), [file-type](https://github.com/sindresorhus/file-type) e [parâmetros do LibreOffice](https://help.libreoffice.org/latest/en-US/text/shared/guide/start_parameters.html).
