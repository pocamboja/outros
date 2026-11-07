# Estúdio: BeatVox + Deriva

Uma app web instalável (PWA) que junta as duas apps no mesmo relógio de áudio, pensada para o **Galaxy Tab S9 com um teclado Arturia por USB-C**. Funciona também em qualquer PC com Chrome ou Edge.

- **BeatVox**: beatbox → bateria, melodia → piano roll, mistura 3D e exportação (igual ao ramo `main`).
- **Deriva**: o sintetizador de acordes em que cada voz desliza para a nota mais próxima do acorde seguinte.

## Instalar no tablet
1. No Chrome do tablet abre **https://pocamboja.github.io/outros/**
2. Menu ⋮ → **Adicionar ao ecrã inicial** (ou **Instalar app**).
3. Abre pelo ícone: fica em ecrã inteiro e funciona **sem internet** depois da primeira abertura.
4. Liga o Arturia por USB-C (diretamente ou com um adaptador OTG). O Android reconhece-o sem drivers.
5. Toca em **Começar**. O Chrome pede autorização para usar dispositivos MIDI: aceita.

## O teclado
| no Arturia | faz |
|---|---|
| **teclas** | tocam o Deriva, em qualquer separador (o beat continua a tocar) |
| **pads** (canal 10) | tocam a bateria do BeatVox: bombo, tarola, palmas, hi-hat fechado e aberto |
| **knobs** | controlam parâmetros do Deriva com **MIDI learn** |
| **pedal de sustain** | segura as notas do Deriva |
| **pitch bend** | ±2 semitons no Deriva |

- **MIDI learn**: separador Deriva → **MIDI learn** → toca num knob do ecrã → roda um knob do teclado. Repete para outros knobs e depois carrega em **terminar learn**. Funciona com knobs absolutos e encoders relativos (são detetados sozinhos).
- **Pads**: ⚙ no topo → *Pads → bateria* → **aprender** em cada som e bate no pad que queres. Ali também escolhes o canal dos pads e que entradas MIDI usar.

## Gravar o que tocas
1. Carrega em **REC** no topo (se o beat estiver parado, começa a tocar).
2. **Pads** → as pancadas ficam na grelha da bateria do BeatVox, alinhadas ao passo mais próximo.
3. **Teclas** → as notas ficam na **faixa de acordes** do Deriva, quantizadas (livre, 1/16, 1/8 ou 1/4) e tocam em loop com o beat. Os acordes gravados também deslizam uns para os outros.
4. Na faixa de acordes: **desfazer** apaga a última passagem gravada, **limpar** apaga tudo e **MIDI ↓** exporta `deriva-acordes.mid` para o Ableton ou o FL Studio.

O tempo das notas é medido pelo som que estava a sair das colunas no momento em que tocaste, por isso a latência do tablet já está compensada.

## Barra de topo
**Tocar/Parar** · **REC** · **clique** (metrónomo) · posição (compasso.tempo) · **BPM** − / + (mantém carregado para mudar depressa) · estado do MIDI (pisca a cada mensagem) · ⚙ definições.

## Ficheiros
```
index.html            o estúdio (barra de topo, encaminhamento MIDI, relógio partilhado)
sw.js                 guarda tudo no tablet para funcionar offline
manifest.webmanifest  nome, ícone e ecrã inteiro da app instalada
beatvox/              o BeatVox (codigo-fonte do main + 2 ganchos pequenos)
deriva/               o Deriva web (engine.js = motor de som em AudioWorklet)
```
Os dois ganchos no BeatVox: `js/app.js` exporta `togglePlay`/`restartIfPlaying`, e `js/audio.js` não repete uma pancada de pad que acabou de soar ao vivo.

## Atualizar
Este ramo (`gh-pages`) é gerado. Depois de publicares uma versão nova, a app instalada mostra o aviso "Há uma versão nova": fecha-a e volta a abrir.
