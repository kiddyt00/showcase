const db = require("better-sqlite3")(require("path").join(__dirname, "..", "data", "showcase.db"));
const row = db.prepare("select scenes from video_jobs where slug=? and orientation=?").get("unslop-claude-skill-ui-redesign", "landscape");
const scenes = JSON.parse(row.scenes);
console.log("scenes:", scenes.length);
console.log(JSON.stringify(scenes[0], null, 1).slice(0, 1200));

