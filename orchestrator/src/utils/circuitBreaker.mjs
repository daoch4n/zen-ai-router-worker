export class CircuitBreaker {
    constructor(serviceName, failureThreshold, resetTimeout) {
        this.serviceName = serviceName;
        this.failureThreshold = failureThreshold; // Number of consecutive failures to open the circuit
        this.resetTimeout = resetTimeout;       // Time in ms before attempting to close the circuit (HALF_OPEN)
        this.state = 'CLOSED';
        this.failureCount = 0;
        this.lastFailureTime = 0;
        this.pendingRequests = 0; // Track requests during HALF_OPEN to count successes
        this.logger = console; // Basic logger for now, can be replaced with actual logger
    }

    /**
     * Attempts to execute a function, applying circuit breaker logic.
     * @param {Function} func The function to execute (e.g., fetch call).
     * @param {Array} args Arguments to pass to func.
     * @returns {Promise<any>} The result of the function or an error if the circuit is open.
     */
    async execute(func, ...args) {
        this.logger.log(`CircuitBreaker[${this.serviceName}]: Current state: ${this.state}`);

        if (this.state === 'OPEN') {
            const now = Date.now();
            if (now - this.lastFailureTime > this.resetTimeout) {
                this.state = 'HALF_OPEN';
                this.logger.warn(`CircuitBreaker[${this.serviceName}]: Transitioned to HALF_OPEN.`);
                this.pendingRequests = 0; // Reset pending requests for HALF_OPEN
            } else {
                this.logger.error(`CircuitBreaker[${this.serviceName}]: Circuit is OPEN. Failing fast.`);
                throw new Error(`CircuitBreaker[${this.serviceName}]: Circuit is OPEN. Service unavailable.`);
            }
        }

        if (this.state === 'HALF_OPEN') {
            if (this.pendingRequests >= 1) { // Only allow one trial request in HALF_OPEN
                this.logger.warn(`CircuitBreaker[${this.serviceName}]: In HALF_OPEN, already testing. Failing fast for additional requests.`);
                throw new Error(`CircuitBreaker[${this.serviceName}]: Circuit is HALF_OPEN, only one trial request allowed.`);
            }
            this.pendingRequests++;
            this.logger.log(`CircuitBreaker[${this.serviceName}]: In HALF_OPEN, attempting trial request.`);
        }

        try {
            const result = await func(...args);
            this.success();
            return result;
        } catch (error) {
            this.fail(error);
            throw error; // Re-throw the error so the caller can handle it
        }
    }

    /**
     * Marks a successful execution.
     */
    success() {
        if (this.state === 'HALF_OPEN') {
            this.failureCount = 0; // Reset failure count on success in HALF_OPEN
            this.state = 'CLOSED';
            this.logger.info(`CircuitBreaker[${this.serviceName}]: Trial request successful. Transitioned to CLOSED.`);
        } else if (this.state === 'CLOSED') {
            this.failureCount = 0; // Reset failure count on success in CLOSED
            this.logger.log(`CircuitBreaker[${this.serviceName}]: Success. Failure count reset.`);
        }
        this.pendingRequests = 0; // Reset regardless of state
    }

    /**
     * Marks a failed execution.
     * @param {Error} error The error that occurred.
     */
    fail(error) {
        this.failureCount++;
        this.lastFailureTime = Date.now();
        this.logger.error(`CircuitBreaker[${this.serviceName}]: Failure detected (${this.failureCount}/${this.failureThreshold}). Error: ${error.message}`);

        if (this.state === 'HALF_OPEN') {
            this.state = 'OPEN'; // Immediately open if a request fails in HALF_OPEN
            this.logger.warn(`CircuitBreaker[${this.serviceName}]: Trial request failed. Transitioned to OPEN.`);
        } else if (this.state === 'CLOSED' && this.failureCount >= this.failureThreshold) {
            this.state = 'OPEN';
            this.logger.warn(`CircuitBreaker[${this.serviceName}]: Failure threshold reached (${this.failureCount}). Transitioned to OPEN.`);
        }
        this.pendingRequests = 0; // Reset regardless of state
    }

    /**
     * Resets the circuit breaker to the CLOSED state.
     */
    reset() {
        this.state = 'CLOSED';
        this.failureCount = 0;
        this.lastFailureTime = 0;
        this.pendingRequests = 0;
        this.logger.info(`CircuitBreaker[${this.serviceName}]: Manually reset to CLOSED.`);
    }

    /**
     * Gets the current state of the circuit breaker.
     * @returns {string} The current state ('CLOSED', 'OPEN', 'HALF_OPEN').
     */
    getState() {
        return this.state;
    }
}