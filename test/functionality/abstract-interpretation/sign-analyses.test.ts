import { describe, it, expect } from 'vitest';
import { withShell } from '../_helper/shell';
import { PipelineExecutor } from '../../../src/core/pipeline-executor';
import { DEFAULT_ABSINT_PIPELINE } from '../../../src/core/steps/pipeline/default-pipelines';

describe('Sign Tests', () => {
  describe('Pipeline Executor with ABSINT', () => {
    it('should generate a normalized AST', async () => {
      await withShell(async (shell) => {
        // Create an instance of the PipelineExecutor
        const executor = new PipelineExecutor(DEFAULT_ABSINT_PIPELINE, {
          shell,
          domain: 'Sign',
          request: { request: 'file', content: 'test/testfiles/example.R' },
        });

        // Execute the remaining steps in the pipeline
        const result = await executor.allRemainingSteps();

        // Assume that `normalize.ast` is the expected structure in the result
        const normalizeAst = result?.normalize?.ast;

        // Check that normalizeAst is not null/undefined
        expect(normalizeAst).toBeDefined();
        console.log('Normalized AST:', normalizeAst);
      });
    });
  });
});
