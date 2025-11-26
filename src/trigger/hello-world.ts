import { logger, schemaTask } from '@trigger.dev/sdk/v3';

export const helloWorldTask = schemaTask({
    id: 'hello-world',
    run: async (payload: unknown, params: { ctx: { run: any } }) => {
        logger.info('Hello, world!');
        return 'Hello, world!';
    },
});
