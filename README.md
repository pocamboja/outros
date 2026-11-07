# Estúdio: BeatVox + Deriva

Uma app web instalável (PWA) que junta as duas apps no mesmo relógio de áudio, pensada para o **Galaxy Tab S9 com um teclado Arturia por USB-C**. Funciona também em qualquer PC com Chrome ou Edge.

- **BeatVox**: beatbox → bateria, melodia → piano roll, mistura 3D com efeitos que acrescentas, kits de bateria e biblioteca com os teus samples, e exportação (WAV com a duração exata do loop, stems alinhados, MIDI). É a versão do ramo `branch2`.
- **Deriva**: o sintetizador de acordes em que cada voz desliza para a nota mais próxima do acorde seguinte, com 8 tipos de oscilador, acordes à tua escolha nos pads e padrões feitos com eles.

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

## BeatVox
- Avanças com o scroll (ou deslizando no tablet): o passo sobe e o seguinte entra por baixo, como numa página. Em baixo à direita vês em que passo estás (**3 / 6 · Bateria**) e tens anterior / seguinte.
- Dentro do Estúdio, a barra de topo do hub faz de transporte (tocar, clique, BPM); o BeatVox não repete a sua.
- O equalizador de LEDs só aparece a gravar (mostra o que o microfone ouve). O palco da mistura não roda sozinho (liga *Rodar* se quiseres).

## Deriva
### Osciladores
Em **oscillator → type** escolhes o tipo; o knob **timbre** muda o carácter de cada um (o **wave** só serve ao *morph*):

| tipo | som | timbre |
|---|---|---|
| **morph** | seno → triângulo → serra → quadrada (o original) | — (usa *wave*) |
| **pulse** | onda de pulso, PWM | largura (50 % → 5 %) |
| **super** | 7 serras desafinadas (supersaw) | abertura |
| **fm** | FM 1:1, piano elétrico e teclas | brilho (segue o *mod env*) |
| **bell** | FM 1:3,5, sinos e mallets | brilho (segue o *mod env*) |
| **sync** | serra com hard sync, leads | altura da serra escrava |
| **fold** | seno dobrado (wavefolder) | quanto dobra |
| **organ** | órgão de registos | registos agudos |

Os presets estão agrupados em *pads*, *teclas*, *leads* e *baixos* (16 no total).

### Acordes dos pads
**editar acordes** → toca num pad e escolhe **tónica**, **tipo** (maior, menor, 7, maj7, m7, sus, 6, add9, 9, m9, 11, 13, dim, aug, power…), **inversão**, **voicing** (fechado, drop 2, aberto, largo) e **oitava**. Ouves o acorde a cada mudança.
**Preencher pelo tom**: escolhe o tom, maior/menor e tríades/sétimas, e os 8 pads ficam com os acordes desse tom (I a vii e um acorde de cor), com inversões escolhidas para as vozes andarem pouco. *Repor os de origem* volta aos pads iniciais. Tudo fica guardado no tablet.

### Padrões
Quatro padrões (**A–D**). Em cada um escolhes **compassos** (1, 2, 4), **acordes por compasso** (1, 2, 4, 8) e o **ritmo**: sustentado, stabs, arpejo ↑ / ↓ / ↕ ou strum, com as **notas do ritmo** a 1/4, 1/8 ou 1/16.
- Escolhe em **pôr nas casas** um acorde (ou *continuar* / *pausa*) e clica nas casas. Clicar outra vez com o mesmo acorde apaga a casa.
- **▶ tocar**: no Estúdio toca com o beat do BeatVox (e põe-no a tocar); sozinho usa o **bpm** do padrão. A casa que está a tocar fica sublinhada.
- **encadear A→D** toca os padrões que têm acordes, um a seguir ao outro.
- **MIDI ↓** exporta o padrão (ou a cadeia) com o ritmo, para o Ableton ou o FL Studio.

## Barra de topo
**Tocar/Parar** · **REC** · **clique** (metrónomo) · posição (compasso.tempo) · **BPM** − / + (mantém carregado para mudar depressa) · estado do MIDI (pisca a cada mensagem) · ⚙ definições.

## Ficheiros
```
index.html            o estúdio (barra de topo, encaminhamento MIDI, relógio partilhado)
sw.js                 guarda tudo no tablet para funcionar offline
manifest.webmanifest  nome, ícone e ecrã inteiro da app instalada
beatvox/              o BeatVox (codigo-fonte da branch2 + 2 ganchos pequenos)
deriva/               o Deriva web (engine.js = motor de som em AudioWorklet)
```
Os dois ganchos no BeatVox: `js/app.js` exporta `togglePlay`/`restartIfPlaying`, e `js/audio.js` não repete uma pancada de pad que acabou de soar ao vivo.

## Atualizar
Este ramo (`gh-pages`) é gerado. Depois de publicares uma versão nova, a app instalada mostra o aviso "Há uma versão nova": fecha-a e volta a abrir.
