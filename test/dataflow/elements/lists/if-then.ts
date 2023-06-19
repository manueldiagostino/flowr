import {
  DataflowGraph,
  GlobalScope,
  LocalScope
} from '../../../../src/dataflow'
import { assertDataflow, withShell } from '../../../helper/shell'

describe("Lists with if-then constructs", withShell(shell => {
  for(const assign of [ '<-', '<<-', '=']) {
    const scope = assign === '<<-' ? GlobalScope : LocalScope
    describe(`using ${assign}`, () => {
      describe(`reads within if`, () => {
        for (const b of [
          { label: "without else", text: "" },
          { label: "with else", text: " else { 1 }" },
        ]) {
          describe(`${b.label}`, () => {
            assertDataflow(`read previous def in cond`,
              shell,
              `x ${assign} 2\nif(x) { 1 } ${b.text}`,
              new DataflowGraph()
                .addNode( { tag: 'variable-definition', id: "0", name: "x", scope: scope })
                .addNode( { tag: 'use', id: "3", name: "x" })
                .addEdge("3", "0", "read", "always")
            )
            assertDataflow(`read previous def in then`,
              shell,
              `x ${assign} 2\nif(TRUE) { x } ${b.text}`,
              new DataflowGraph()
                .addNode( { tag: 'variable-definition', id: "0", name: "x", scope: scope })
                .addNode( { tag: 'use', id: "4", name: "x" })
                .addEdge("4", "0", "read", "maybe")
            )
          })
        }
        assertDataflow(`read previous def in else`,
          shell,
          `x ${assign} 2\nif(TRUE) { 42 } else { x }`,
          new DataflowGraph()
            .addNode( { tag: 'variable-definition', id: "0", name: "x", scope: scope })
            .addNode( { tag: 'use', id: "5", name: "x" })
            .addEdge("5", "0", "read", "maybe")
        )
      })
      describe(`write within if`, () => {
        for (const b of [
          { label: "without else", text: "" },
          { label: "with else", text: " else { 1 }" },
        ]) {
          assertDataflow(`${b.label} directly together`,
            shell,
            `if(TRUE) { x ${assign} 2 }\nx`,
            new DataflowGraph()
              .addNode( { tag: 'variable-definition', id: "1", name: "x", scope: scope })
              .addNode( { tag: 'use', id: "5", name: "x" })
              .addEdge("5", "1", "read", "maybe")
          )
        }
        assertDataflow(`def in else read afterwards`,
          shell,
          `if(TRUE) { 42 } else { x ${assign} 5 }\nx`,
          new DataflowGraph()
            .addNode( { tag: 'variable-definition', id: "2", name: "x", scope: scope })
            .addNode( { tag: 'use', id: "6", name: "x" })
            .addEdge("6", "2", "read", "maybe")
        )
        assertDataflow(`def in then and else read afterward`,
          shell,
          `if(TRUE) { x ${assign} 7 } else { x ${assign} 5 }\nx`,
          new DataflowGraph()
            .addNode( { tag: 'variable-definition', id: "1", name: "x", scope: scope })
            .addNode( { tag: 'variable-definition', id: "4", name: "x", scope: scope })
            .addNode( { tag: 'use', id: "8", name: "x" })
            .addEdge("8", "1", "read", "maybe")
            .addEdge("8", "4", "read", "maybe")
          // TODO: .addEdge('4', '1', 'same-def-def', 'always')
        )
      })
    })
  }
  // TODO: others like same-read-read?
  // TODO: write-write if
}))
