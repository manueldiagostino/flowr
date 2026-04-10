import { log } from '../../util/log';

/**
 * Logger for the vector abstract interpretation module.
 *
 * Usage:
 * ```typescript
 * import { vectorLogger } from './logger';
 * vectorLogger.trace('message');
 * ```
 */
export const vectorLogger = log.getSubLogger({ name: 'vector' });
