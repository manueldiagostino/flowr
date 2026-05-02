import { absintLogger } from '../logger';

/**
 * Logger for the vector abstract interpretation module.
 * This is a sub-logger of absintLogger.
 *
 * Usage:
 * ```typescript
 * import { vectorLogger } from './logger';
 * vectorLogger.trace('message');
 * ```
 */
export const vectorLogger = absintLogger.getSubLogger({ name: 'vector' });
