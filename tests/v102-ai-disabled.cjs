/* Mathroom v102: AI is disabled in the browser and on both server entrypoints.
 * Run: node tests/v102-ai-disabled.cjs
 * Source-only contract, no network, no production writes.
 */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const read=x=>fs.readFileSync(path.join(root,x),'utf8');
const app=read('app-v341.js'),builder=read('js/task-builder-v60.js');
const html=read('index.html'),build=read('build.json');
const pipeline=read('supabase/functions/task-pipeline/index.ts');
const worker=read('supabase/functions/task-supply-worker/index.ts');

assert.match(build,/102\.0-no-ai/);
assert.match(html,/app-v341\.js\?v=102\.0-no-ai/);
assert.match(html,/js\/task-builder-v60\.js\?v=102\.0-no-ai/);
assert.doesNotMatch(html,/task-pipeline-v62\.(?:js|css)/);
assert.doesNotMatch(html,/task-supply-v89\.js/);

assert.doesNotMatch(app,/id="openTaskPipeline"/);
assert.doesNotMatch(app,/data-bank-similar/);
assert.doesNotMatch(app,/renderTaskSupply\(\);\s*\n\s*\}/);
assert.match(app,/if\(S\.view==='task-pipeline'\|\|S\.view==='task-supply'\)\{S\.view='bank';return renderBank\(\);\}/);
assert.match(app,/data-bank-variants=/);
assert.match(app,/openExerciseVariants\(e\)/);
assert.match(app,/function isTemplateExercise\(/);
assert.match(app,/function generateExerciseVariants\(/);

assert.doesNotMatch(builder,/id="tbAllowAi"/);
assert.doesNotMatch(builder,/data-source="ai"/);
assert.doesNotMatch(builder,/q\("tbAllowAi"\)/);
assert.match(builder,/allow_ai_example:false/);
assert.match(builder,/state\.settings\.allowAi=false/);
assert.match(builder,/id="tbTemplateReroll"/);
assert.match(builder,/generateTemplateScope/);
assert.match(builder,/MathroomMathCheckV99/);

assert.match(pipeline,/const AI_FEATURES_ENABLED = false/);
assert.match(worker,/const AI_FEATURES_ENABLED = false/);
const pipelineGate=pipeline.indexOf('if (!AI_FEATURES_ENABLED)');
const firstAuth=pipeline.indexOf('const { client, user } = await getContext');
const firstAI=pipeline.indexOf('const generated = await openai');
assert.ok(pipelineGate>0&&pipelineGate<firstAuth&&pipelineGate<firstAI,
  'pipeline must fail closed before any authentication-context or OpenAI calls');
assert.match(pipeline,/error: 'AI_DISABLED'/);
assert.match(pipeline,/ai_configured: false/);
const workerGate=worker.indexOf('if(!AI_FEATURES_ENABLED)');
const firstSecret=worker.indexOf("const token=req.headers.get('x-mr-supply-cron')");
const firstWorkerFetch=worker.indexOf("await fetch(endpoint");
assert.ok(workerGate>0&&workerGate<firstSecret&&workerGate<firstWorkerFetch,
  'scheduled worker must stop before secret or network access');
new Function(app);new Function(builder);
console.log('v102 PASS: all AI UI entry points gone, local generators retained, server guards fail closed');
