# BeatVox 🥁🎤

Faz beatbox para o microfone e recebe o padrão de bateria numa grelha estilo DAW. Canta uma melodia e recebe as notas num piano roll. Exporta tudo em MIDI.

Duas pistas, escolhidas no topo (**Pista**) ou com as teclas `1` e `2`:
- **Bateria**: beatbox → bombo, tarola, hi-hat…
- **Lead**: melodia cantada → notas, ajustadas ao tom

## Como abrir

**Mais simples:** descompacta a pasta e faz duplo clique em `index.html` (Chrome, Edge, Opera ou Firefox). O browser pede acesso ao microfone: aceita.

O `index.html` tem tudo lá dentro (estilos, código e fontes), por isso até abre diretamente do zip. Mas descompacta na mesma: alguns browsers só deixam usar o microfone em ficheiros que estão no disco.

A pasta `codigo-fonte/` tem o mesmo projeto separado em ficheiros (HTML, CSS e JS), para leres ou alterares.

**Se o microfone não funcionar assim**, usa o lançador (precisa de Python instalado):
- Windows: duplo clique em `iniciar.bat`
- Mac / Linux: `./iniciar.sh` no terminal

Isto abre a app em `http://localhost:8765`.

Tudo corre no teu computador — nada é enviado para a internet.

## A experiência

O BeatVox é uma peça em 6 movimentos (I a VI). Faz **scroll** (roda do rato, trackpad, setas ou deslizar no telemóvel) e cada movimento transforma-se no seguinte. Ao mesmo tempo, o pó dourado do fundo muda de forma: um disco de vinil com um reflexo de luz a correr pelos sulcos, o anel do compasso, o chão do sequenciador, uma pauta com a melodia, a órbita da mistura e, no fim, o teu disco.

1. **Abertura**
2. **Andamento**: BPM (escreve, usa + e −, ou carrega em *Marcar o tempo* ao ritmo da música), compassos, grelha, clique, auscultadores, **microfone** (escolher e testar) e latência.
3. **Bateria**: gravar ou abrir áudio, a grelha, treinar a tua voz. Aqui o fundo é um **equalizador 3D de blocos LED** (verde → amarelo → laranja → vermelho) que segue o som: brilha por trás do vidro da grelha quando tocas e, enquanto gravas, aparece inteiro por baixo da contagem a mostrar a tua voz em tempo real. As notas da grelha também são colunas de LEDs: quantos mais blocos acesos, mais forte o golpe.
4. **Melodia**: gravar por cima do beat, o piano roll, **efeitos da voz**, tom, escala, oitava e som.
5. **Mistura**: o palco 3D, ver [Mistura](#mistura-o-palco-3d).
6. **Exportar**: uma capa para o teu beat (com nome, que podes ouvir ali mesmo) e todas as saídas, ver [Exportar](#exportar).

- A navegação à esquerda (ou à direita, no telemóvel) leva-te a qualquer passo. As teclas `1` e `2` saltam para a Bateria e para a Melodia.
- O botão **Tocar**, no topo, toca a bateria e a melodia juntas, em qualquer passo.
- **Metrónomo**: o botão **Clique**, no topo, liga ou desliga o clique ao tocar e ao gravar (acento no primeiro tempo de cada compasso). Sem notas, Tocar dá só o clique, bom para treinar o ritmo. No passo Andamento, **Ouvir o clique** faz o mesmo, e mudar o BPM a tocar muda logo o andamento. A contagem antes de gravar acontece sempre.
- Enquanto gravas, o scroll fica bloqueado para não mudares de passo sem querer.
- As partículas reagem ao som: à tua voz quando gravas e à música quando tocas.
- **Abrir áudio**: carrega um ficheiro (WAV, MP3, M4A, OGG) em vez de gravar. O primeiro som do ficheiro conta como o primeiro tempo do compasso.
- **Botões rotativos** (Sensibilidade, Latência): arrasta para cima ou para baixo, usa a roda do rato ou as setas. Duplo clique repõe o valor.

## Como usar

1. **Põe auscultadores.** Sem eles o microfone apanha o metrónomo e aparecem golpes falsos.
2. Escolhe o **BPM**, quantos **compassos** e a **grelha** (1/16 é o normal).
3. Carrega em **Gravar** (ou tecla `R`). Ouves 1 compasso de contagem e depois gravas.
4. Faz beatbox:

   | Som | Peça |
   |---|---|
   | "bum", "b" | Bombo (kick) |
   | "pf", "ka", "tch" | Tarola (snare) |
   | "ts", "t" | Hi-hat fechado |

5. O padrão aparece na grelha. **Espaço** toca/para em loop.
6. No movimento V, **Exportar** → arrasta o `.mid` para o FL Studio (Channel Rack / Piano Roll), Ableton (pista MIDI com Drum Rack) ou outro DAW.

**MIDI completo** junta as duas pistas num só ficheiro: bateria no canal 10 e lead no canal 1. No FL Studio, arrasta-o para a Playlist e escolhe importar.

### Editar à mão (Bateria)
- **Clicar** numa célula vazia → acrescenta nota (e ouves o som)
- **Clicar** numa nota → apaga
- **Arrastar** uma nota para cima/baixo → muda a velocidade (força)
- As marquinhas brancas no topo de cada nota mostram **onde realmente cantaste** antes de alinhar à grelha — ótimo para treinar o timing.

## Lead (melodias)

1. Muda para a pista **Lead**.
2. Se já tens bateria, deixa ligado **Gravar por cima do beat** (cartão Lead): ouves o teu beat enquanto cantas. Desliga para cantar só com o metrónomo.
3. Carrega em **Gravar** e canta com vogais longas e claras: "lá", "na-na", "du-du". Para repetir a mesma nota, separa com uma consoante ("da-da-da").
4. As notas aparecem no **piano roll**. A linha branca por cima é **a curva real da tua voz** — vês o vibrato, as entradas desafinadas e onde fugiste da nota.

### Tom e escala
- **Auto** deteta o tom da tua melodia (ex.: Lá menor) e "puxa" cada nota para a nota mais próxima dessa escala — corrige pequenas desafinações.
- Podes escolher o tom e a escala à mão: Maior, Menor, Pentatónica menor/maior, Blues, ou **Cromática** (sem ajuste — fica exatamente o que cantaste, arredondado ao meio-tom).
- **Oitava ±**: a voz costuma ser grave para um lead; sobe 1 oitava para soar como um synth lead.
- **Som**: Synth, Pluck ou Suave (só para ouvires aqui — no DAW escolhes o instrumento que quiseres).

### Editar à mão (Lead)
- **Clicar** numa célula vazia → cria nota (arrasta logo para a alongar)
- **Arrastar** uma nota → move no tempo e na altura
- **Puxar a ponta direita** → muda a duração
- **Clicar** numa nota → apaga
- **Clicar numa tecla** do piano à esquerda → ouves a nota

O cartão **A tua afinação** mostra a afinação média (em cents; 100 cents = 1 meio-tom), se tendes a cantar alto ou baixo, e quantas notas saíram da escala.

Nomes das notas: Dó4 = C4 = Dó central (MIDI 60). Atenção: o FL Studio chama C5 a esta mesma nota — é só o nome, a nota é a mesma.

## Mistura: o palco 3D
Cada **camada** é uma dimensão do som: Graves, Médios e Agudos (ou 6 camadas: Sub, Graves, Médios-graves, Médios, Agudos, Ar). Cada som é um nó:
- a **altura** do nó é o centro de frequência real do som (medido renderizando esse som sozinho);
- em **cada camada** onde o som tem energia aparece um disco, maior quanto mais presença tem ali. Um bombo é um disco grande nos graves e pequeno nos agudos (o clique); se dois sons têm discos grandes na mesma camada, estão a disputar o mesmo espaço;
- **esquerda-direita** é o pan, **frente-trás** é o volume (à frente = mais alto). Arrasta um nó para mudar os dois;
- as **ligações** levam cada som ao **Master** e aos efeitos (**Reverb** e **Delay**). A espessura é o envio, e as partículas correm ao ritmo do som quando tocas.

Arrasta o fundo para rodar, usa + e − (ou pinça no trackpad) para aproximar. Clica num som (no palco ou na lista) para o ajustar:
- **Volume, Pan, Mute (M), Solo (S)**;
- **EQ** de 3 bandas (graves, médios, agudos): o nó muda de altura e os discos mudam de tamanho;
- **Som**: afinação e decaimento do bombo, tom da tarola e das palmas, brilho dos hi-hats, timbre da melodia, afinação/decaimento/saturação do 808;
- **Envios** para o reverb e o delay. Clica no Reverb (tamanho, nível) ou no Delay (tempo 1/8, 1/8 pontuada ou 1/4 no andamento do beat, repetições, nível).

**Baixo 808**: liga-o na barra do palco. Toca uma nota em cada bombo, no tom da melodia (segue a nota da melodia que estiver a tocar), e aparece no MIDI como uma pista própria (canal 2) e nos stems.

As tuas **gravações de voz** também são nós (começam em mudo). Tira o M para as juntares ao beat. O que ouves é o que exportas: o WAV e os stems saem com a mistura. O MIDI leva só as notas (a mistura faz-se no teu DAW). A mistura fica guardada no projeto.

## Efeitos da voz (melodia)
A forma como cantas controla efeitos no som da melodia, em contínuo (não há "modos": quanto mais, mais):

| Efeito | O que fazes com a voz | O que acontece ao som | No MIDI |
|---|---|---|---|
| **Volume** | Cantar mais forte ou mais baixo | O filtro abre e o volume sobe | CC11 (expression) |
| **Glide** | Deslizar entre notas, entrar na nota "por baixo" | Pitch bend | Pitch bend (±2 semitons) |
| **Vibrato** | O teu vibrato | Pitch bend | Pitch bend |
| **Ar** | Voz com ar, sussurrada | Reverb | CC91 (reverb) |
| **Garra** | Voz rasgada, gritada | Distorção | CC1 (mod wheel) |
| **Vogais** | "uuu" ↔ "aaa" ↔ "iii" | Filtro wah (fecha no "u", abre no "i") | CC74 (brilho/cutoff) |

- Cada efeito tem um **botão** no movimento IV para o ligar ou desligar quando quiseres, sem gravar de novo (o interruptor ao lado do título liga ou desliga todos). Vale para o que ouves, para o WAV e para o MIDI.
- Por baixo do piano roll, na faixa *A tua voz*, cada efeito ligado aparece como uma linha da mesma cor do botão: vês o que a app ouviu na tua voz.
- **Calibrar a voz** (recomendado): 5 takes curtas (normal, rasgado, com ar, "uuu" e "iii"), um compasso cada. A partir daí a app compara-te contigo próprio. Sem calibração usa valores médios, que funcionam pior em micros fracos.
- No FL Studio: no MIDI completo, as curvas vêm na pista do lead. Liga o CC1, CC74, CC91 ou CC11 a qualquer botão de um plugin (*Link to controller*).
- Se mexeres nas notas depois de gravar, o glide e o vibrato são recalculados para as notas novas; se moveres uma nota para muito longe do que cantaste, essa nota fica sem bend.
- O projeto (.beatvox.json) guarda as curvas e os botões ligados.

## Exportar
- **Nome**: dá nome ao beat. Vai para a capa e para os nomes dos ficheiros (`noite-em-lisboa-90bpm.wav`).
- **Repetições do loop** (1×, 2×, 4×, 8×): quantas vezes o loop se repete no MIDI e no WAV.
- **MIDI**: completo (2 pistas), só bateria ou só melodia.
- **Áudio WAV**: o beat já tocado com os sons da app (44,1 kHz, estéreo), para ouvir no telemóvel ou mandar a alguém. **Stems**: bateria e melodia em WAV separados (num zip).
- **Capa**: imagem quadrada de 1600 px, com as colunas LED do beat e a linha da melodia.
- **Projeto**: guarda as notas e definições num `.beatvox.json` e **Abrir** volta a carregá-lo mais tarde (a gravação da voz não vai no ficheiro).
- **Descarregar tudo (.zip)**: MIDI, WAV, stems, capa e projeto de uma vez.

No link web, os ficheiros .mid e .wav vêm dentro de um .zip (a página só deixa descarregar certos tipos de ficheiro).

### Microfone de portátil
O micro do portátil corta graves e agudos e grava baixo. O BeatVox foi afinado para isso:
- **Testa o microfone** no movimento II: fala ou faz beatbox e vê a barra. Deve chegar a meio. Se tiveres mais do que um microfone, escolhe-o na lista.
- Durante a gravação aparece um **medidor**. Se a gravação sair muito baixa, o volume é reforçado e recebes um aviso.
- A bateria é classificada **comparando os teus sons entre si**. Cada golpe é descrito pelo brilho do som inteiro e do "corpo" (depois do estalo da consoante) e pela energia em 6 bandas. Os golpes são agrupados (até 4 tipos de som), os grupos parecidos juntam-se, e cada grupo é decidido pela maioria dos seus golpes: o mais grave é o bombo, o mais agudo o hi-hat, os do meio tarola. Assim o "ka" já não passa por bombo nem o "pf" por hi-hat, mesmo quando o micro deixa o "bum" sem graves e o "ts" abafado.
- A gravação corre num **AudioWorklet** (na linha de áudio do browser) e cada bloco guarda o instante exato em que foi gravado. Se o portátil estiver ocupado (animações, outros separadores), a gravação não se desloca no tempo.
- O "pf" e o "ts" longos já não dão golpes duplicados, e uma gravação só com bombos num micro fraco já é detetada por inteiro.
- Os golpes fracos que só se destacam nos agudos (o "ts" num micro fraco) também são apanhados.
- Dicas: fala a 20–30 cm do portátil, exagera o "ts" e, se faltarem hi-hats, sobe a **Sensibilidade**. Com auscultadores ligados o micro não apanha o clique.

### Afinar
- **Sensibilidade**: sobe se faltam golpes ou notas; desce se aparecem a mais.
- **Latência / Calibrar**: se as notas aparecem sempre um pouco atrasadas, carrega em *Calibrar* e bate palmas em cada clique durante 2 compassos.
- **Treinar com a minha voz** (o mais fiável, sobretudo em micros fracos): grava exemplos de cada som (bombo, tarola, palmas, hi-hat fechado/aberto). Com 2 ou mais peças treinadas, a app passa a reconhecer a *tua* voz em vez de usar regras gerais. É também a única forma de detetar **palmas** e **hi-hat aberto**.
- O cartão **O teu timing** mostra o desvio médio em relação à grelha e se tendes a adiantar-te ou atrasar-te.

## Como funciona (por dentro)

```
microfone → gravação (com metrónomo e contagem)
          → deteção de ataques (fluxo espetral por bandas + subida de energia)
          → características de cada golpe (brilho do som e do corpo, 6 bandas, ruído, decaimento)
          → classificação (agrupamento dos teus sons + maioria por grupo, ou k-vizinhos com o teu treino)
          → quantização à grelha → notas → MIDI (canal 10, notas GM)
```

| Ficheiro | O quê |
|---|---|
| `js/dsp.js` | FFT, deteção de ataques, extração de características |
| `js/classifier.js` | Lista de peças (cores, notas MIDI) e classificador |
| `js/pitch.js` | Deteção de altura (YIN), segmentação em notas, tom e escala |
| `js/voicefx.js` | Efeitos da voz: medidas de timbre a cada 10 ms, calibração, curvas de efeitos |
| `js/audio.js` | Microfone, gravação (com acompanhamento), metrónomo, calibração, sintetizadores de bateria e lead |
| `js/midi.js` | Escrita do ficheiro `.mid` (bateria, melodia com curvas dos efeitos, 808) |
| `js/app.js` | Interface, grelha, edição, exportação |
| `js/knob.js` | Botões rotativos acessíveis |
| `js/mixer.js` | Mesa de mistura: canal por som (EQ, pan, volume, envios), reverb, delay, perfil de espetro |
| `js/stage3d.js` | Palco 3D da mistura (camadas de frequência, nós, ligações, arrastar) |
| `js/scene.js` | Fundo 3D de partículas em WebGL (muda com o scroll e reage ao som) |
| `js/eq3d.js` | Equalizador 3D de blocos LED do movimento III (WebGL) |
| `js/flow.js` | Passos e transições guiadas pelo scroll |
| `js/zip.js` | Zip simples (pacote completo, stems, e MIDI/WAV no link web) |

Lead: a voz é reduzida a ~16 kHz, a altura é seguida a cada 10 ms com o algoritmo **YIN**, a curva é limpa com um filtro de mediana, e cada nota começa quando a altura muda de forma estável (> ¾ de meio-tom durante 40 ms) ou quando há uma consoante. O tom é detetado com o método de Krumhansl-Schmuckler.

### Testes
- Bateria: beatbox sintético de 70 a 190 BPM — 64/64 padrões corretos, erro de tempo < 1 ms.
- Beatbox realista ("bum", "pf", "ka", "ts" com variação humana), 528 golpes por micro: bom 100 %, portátil 100 %, micro fraco 95,5 % (antes 86 %, 91 %, 91 %). Conjuntos de sons ao acaso: 97,6 % (antes 80,8 %).
- Efeitos da voz: vozes sintéticas (normal, rasgada, com ar, "u", "i") em micro bom, de portátil e fraco. Calibrado, cada take ativa o seu efeito (garra 0,92–1,0; ar 0,99–1,0; vogal "u" 0,0 e "i" 0,97–1,0) com pouca fuga para os outros (≤ 0,17, exceto ar→garra até 0,33 no micro fraco).
- Lead: melodias sintéticas com vibrato, entradas desafinadas, ligados e notas repetidas, de Mi2 (voz de baixo) a Dó6 — 56/56 corretas, afinação a ±4 cents, início das notas a ±20 ms. Ruído sem voz não gera notas.

## Próximos passos possíveis
- **Mais efeitos da voz**: nasal, falsete, assobio, tremolo, vocal fry.
- **Baixo**: a mesma deteção do lead, mas uma oitava abaixo e com som de baixo.
- **Mais compassos** com secções (verso / refrão).
- **Harmonia**: sugerir acordes que encaixam na melodia cantada.

## Créditos
Fontes Bodoni Moda e Geist (SIL Open Font License, ver `licenses/`), embutidas em `css/fonts.css` para funcionar sem internet.
