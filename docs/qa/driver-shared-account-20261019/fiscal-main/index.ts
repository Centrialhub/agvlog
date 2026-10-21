Deno.serve(async request => {
  const worker = await EdgeRuntime.userWorkers.create({
    servicePath: '/app/docs/qa/driver-shared-account-20261019/fiscal-probe',
    memoryLimitMb: 150, workerTimeoutMs: 60000, noModuleCache: true,
    envVars: [], forceCreate: true,
  });
  return worker.fetch(request);
});
