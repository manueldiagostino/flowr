# ToDo

- [ ] Capire quali problemi ci sono in R, soprattutto `eval`
- [ ] Slicing cos'è
- [ ] Identificare quale algoritmo viene utilizzato e trovarlo nel codice

## Visitor

Una possibile chiamata di

```typescript
function visitAst<OtherInfo = NoInfo>(
  nodes: RNode<OtherInfo> | (RNode<OtherInfo> | null | undefined)[] | undefined,
  onVisit?: OnEnter<OtherInfo>,
  onExit?: OnExit<OtherInfo>,
): void {
  return new NodeVisitor(onVisit, onExit).visit(nodes);
}
```

si trova in `src/statistics/features/supported/assignments/assignments.ts`:

```typescript
function visitAssignment(
  info: AssignmentInfo,
  input: FeatureProcessorInput,
): void {
  const assignmentStack: RNodeWithParent[] = [];

  visitAst(
    input.normalizedRAst.ast,
    (node) => {
      if (
        node.type !== RType.BinaryOp ||
        !AssignmentOperators.has(node.operator)
      ) {
        return;
      }

      if (assignmentStack.length > 0) {
        info.nestedOperatorAssignment++;
        info.deepestNesting = Math.max(
          info.deepestNesting,
          assignmentStack.length,
        );
      }

      assignmentStack.push(node);

      info.assignmentOperator[node.operator] =
        ((info.assignmentOperator[node.operator] as bigint | undefined) ?? 0n) +
        1n;

      switch (node.operator) {
        case "->":
        case "->>":
          info.assigned = updateCommonSyntaxTypeCounts(info.assigned, node.lhs);
          break;
        default:
          info.assigned = updateCommonSyntaxTypeCounts(info.assigned, node.rhs);
          break;
      }
    },
    (node) => {
      // drop again :D
      if (node.type === RType.BinaryOp && node.flavor === "assignment") {
        assignmentStack.pop();
      }
    },
  );
}
```

Da notare il secondo e terzo argomento: due funzioni lambda che prendono un
`node` in input. La prima corrisponde a

```typescript
export type OnEnter<OtherInfo> = (node: RNode<OtherInfo>) => boolean | void;
```

mentre la seconda a

```typescript
export type OnExit<OtherInfo> = (node: RNode<OtherInfo>) => void;
```

definite in `src/r-bridge/lang-4.x/ast/model/processing/visitor.ts`. Ciò che
viene eseguito nella visita è esplicitato dal corpo di queste due lambda.

## Problemi

- Il problema principale è come viene fatta la visita sull'AST normalizzato;
  infatti, i singoli `RNode` non dispongono di un metodo classico `accept(Visitor
v)` e il tipo `RNode` risulta essere una union dei vari tipi di nodo
  disponibili (<https://github.com/flowr-analysis/flowr/wiki/Normalized-AST>).

- Per questo motivo, il "visitor" gestisce con uno `switch case` tutti i tipi di
  `RNode` esplicitamente.

- Una possibile soluzione sarebbe quella di creare una nuova interfaccia che
  abbia all'interno un `RNode` e un metodo virtuale `accept(Visitor v)`, così da
  implementare le analisi come visitor classici.
