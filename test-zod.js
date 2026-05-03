const { z } = require('zod');
const TestSchema = z.object({
  apiKey: z.string().or(z.record(z.string())).optional()
});
console.log(TestSchema.parse({ apiKey: { "API_KEY": "sk-1234" } }));
