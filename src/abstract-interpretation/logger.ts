import { log } from '../util/log';

/**
 * Logger for the abstract interpretation module.
 *
 * Usage:
 * ```typescript
 * import { absintLogger } from './logger';
 * absintLogger.debug('message');
 * ```
 */
export const absintLogger = log.getSubLogger({ name: 'absint' });
