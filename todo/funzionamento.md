# Note sul funzionamento

Nel file `slicer-app.ts` è definita la funzione `getSlice()` da cui parte
l'elaborazione.

```ts
try {
 const { stats: { reconstructedCode, slicingCriteria }, slice: sliced } =
  await slicer.slice(...slices as SlicingCriteria);
 //...
}
```

In `slicer.ts` c'è il corpo del metodo `slice()`:

```ts
public async slice(...slicingCriteria: SlicingCriteria): Promise<BenchmarkSingleSliceStats>
```

In particolare viene chiamata la fase `slicer.init()`:

- carica e prepara il codice R da analizzare
- durante l'inizializzazione, vengono eseguiti diversi passaggi, tra cui il parsing per ottenere un Abstract Syntax Tree (AST) del codice, la normalizzazione dell'AST e l'analisi del dataflow.
- vengono raccolte anche informazioni statistiche iniziali, come il numero di token e caratteri, e il numero di nodi e archi nel grafo di dataflow.

Successivamente viene eseguito lo slicing utilizzando il rispettivo criterio.

## Fase di init

1. Creazione dell'AST normalizzato

   - tramite

     ```ts
     this.normalizedAst = await this.measureCommonStep(
       "normalize",
       "normalize R AST",
     );
     ```

2) Creazione Dataflow graph

   - tramite

     ```ts
     this.dataflow = await this.measureCommonStep(
       "dataflow",
       "produce dataflow information",
     );
     ```

## Creazione Dataflow graph

Dopo il parsing e la normalizzazione dell'AST, BenchmarkSlicer procede con la fase di analisi del dataflow. Questo avviene principalmente nel metodo init, dove viene chiamato measureCommonStep per eseguire il passo di analisi del dataflow e produrre l'oggetto dataflow. Il risultato viene memorizzato in this.dataflow e utilizzato per raccogliere informazioni dettagliate sul flusso dei dati, utili per lo slicing.

La chiamata `measureCommonStep()` provvede a lanciare step della pipeline:

```typescript
private async measureCommonStep<Step extends PipelineStepNames<typeof DEFAULT_SLICING_PIPELINE>>(
 expectedStep: Step,
 keyToMeasure: CommonSlicerMeasurements
 ): Promise<PipelineStepOutputWithName<typeof DEFAULT_SLICING_PIPELINE, Step>> {
 const memoryInit = process.memoryUsage();
 const { result } = await this.commonMeasurements.measureAsync(
  keyToMeasure, () => this.pipeline.nextStep(expectedStep)
 );
 const memoryEnd = process.memoryUsage();
 this.deltas.set(keyToMeasure, {
  heap:     memoryEnd.heapUsed - memoryInit.heapUsed,
  rss:      memoryEnd.rss - memoryInit.rss,
  external: memoryEnd.external - memoryInit.external,
  buffs:    memoryEnd.arrayBuffers - memoryInit.arrayBuffers
 });
 return result as PipelineStepOutputWithName<typeof DEFAULT_SLICING_PIPELINE, Step>;
 }
```

Lo step da eseguire è indicato nel parametro `expectedStep: Step`. La funzione esegue quindi lo step della pipeline invocando `this.pipeline.nextStep(expectedStep)`, che esegue effettivamente il passo specificato.

Ogni step per far ciò definisce il proprio `processor()` che esegue l'azione.
Per il passo 'dataflow' si ha:

```ts
function processor(
  results: { normalize?: NormalizedAst },
  input: { request?: RParseRequests },
) {
  return produceDataFlowGraph(
    input.request as RParseRequests,
    results.normalize as NormalizedAst,
  );
}
```

### Metodi di estrazione del DFG

- La funzione `processDataflowFor` è chiamata con l'AST e i dati necessari (dfData). Questa funzione analizza l'AST del programma e genera un grafo che rappresenta il flusso dei dati.

- La mappa processors associa a ogni tipo di nodo dell'AST (ad esempio, `RType.Number`, `RType.FunctionCall`, `RType.BinaryOp`, ecc.) una funzione di elaborazione. Ogni funzione di processo si occupa di estrarre informazioni dal nodo dell'AST e aggiungere le connessioni appropriate nel grafo.

### Funzione `processDataflowFor`

La funzione `processDataflowFor` è il cuore del processo di creazione del Data Flow Graph. Si occupa di invocare il processore appropriato per ogni tipo di nodo nell'AST (rappresentato da `RNode`) in base al tipo di nodo.

#### Parametri

- `current: RNode<OtherInfo & ParentInformation>`: nodo dell'AST corrente che viene analizzato
- `data: DataflowProcessorInformation<OtherInfo & ParentInformation>`:
  informazioni necessarie per elaborare il nodo e generare il Data Flow Graph.
  Include il `processor`.

#### Funzionamento

1. Viene recuperato il processore specifico: per ogni nodo current, il tipo di nodo (ad esempio, `RType.Number`, `RType.FunctionCall`, `RType.Symbol`, ecc.) viene utilizzato per cercare nel dizionario `processors` il processore associato a quel tipo.

   ```ts
   return (
     data.processors[current.type] as DataflowProcessor<
       OtherInfo & ParentInformation,
       typeof current
     >
   )(current, data);
   ```

2) Invocazione del Processore

   Una volta ottenuto il processore giusto, questo viene eseguito sul nodo corrente. Ogni processore ha la logica per trattare quel tipo di nodo specifico. Ad esempio per un `RNode` di tipo `RType.Symbol` si utilizza il processor `processSymbol` (`extractor.ts`). Ogni processore modifica lo stato attuale del grafo.

   Nel caso che il nodo identifichi un sottografo viene invocata un'esplorazione
   ricorsiva dell'AST. Ad esempio per `RType.BinaryOp`:

   ```ts
   [RType.BinaryOp]: (n, d) => processAsNamedCall(n, d, n.operator, [n.lhs, n.rhs]),
   ```

   Questo significa che quando il tipo di nodo è un'operazione binaria, il flusso di dati invoca la funzione `processAsNamedCall`. La funzione `processAsNamedCall` si occupa di creare un nuovo nodo simbolico per il nome dell'operatore e di elaborare i suoi argomenti (`lhs` e `rhs`).

   La funzione `processAsNamedCall`, definita nel `process-named-call.ts`, esegue una chiamata ricorsiva in un altro processore:

   ```ts
   export function processAsNamedCall<OtherInfo>(
     functionName: RNode<OtherInfo & ParentInformation> &
       Base<OtherInfo> &
       Location,
     data: DataflowProcessorInformation<OtherInfo & ParentInformation>,
     name: string,
     args: readonly (
       | RNode<OtherInfo & ParentInformation>
       | typeof EmptyArgument
       | undefined
     )[],
   ): DataflowInformation {
     return processNamedCall(
       {
         type: RType.Symbol,
         info: functionName.info,
         content: name,
         lexeme: functionName.lexeme,
         location: functionName.location,
         namespace: undefined,
       },
       wrapArgumentsUnnamed(args, data.completeAst.idMap),
       functionName.info.id,
       data,
     );
   }
   ```

   Essa invoca la funzione `processNamedCall` passando un nodo simbolico creato per il nome della funzione e i suoi argomenti (che sono rappresentati come `args`). Gli argomenti (`lhs`, `rhs` nel caso di un `BinaryOp`) vengono processati tramite `wrapArgumentsUnnamed`, che prepara gli argomenti per essere elaborati.

   Nel processore chiamato da `processAsNamedCall`, la funzione `processNamedCall` si occupa di elaborare la chiamata in maniera simile. Poiché `args` contiene nodi dell'AST (come `lhs` e `rhs`), se questi nodi sono a loro volta tipi che richiedono una chiamata ricorsiva, il sistema continuerà a invocare i processori appropriati per quei nodi. Ad esempio, se `lhs` o `rhs` sono a loro volta operazioni binarie o chiamate a funzione, questi nodi verranno elaborati da altri processori in una catena ricorsiva.

   Quindi, la chiamata ricorsiva avviene quando uno degli argomenti (`lhs` o `rhs`) di un `BinaryOp` è un altro nodo che richiede elaborazione. Ad esempio, se `lhs` è un `BinaryOp` o una funzione, il sistema applica il processore appropriato a `lhs` e invoca ricorsivamente il processore, continuando ad esplorare l'AST.
