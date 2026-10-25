require("dotenv").config();
const { createRuntime } = require("./lib/runtime");

let runtime;
try {
  runtime = createRuntime();
} catch (err) {
  console.error(`❌ ${err.message} See backend/.env.example.`);
  process.exit(1);
}

const PORT = Number(process.env.PORT) || 5000;
runtime.app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
