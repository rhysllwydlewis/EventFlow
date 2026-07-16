from pathlib import Path


def replace_once(path, old, new):
    file_path = Path(path)
    text = file_path.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}: {old[:120]!r}")
    file_path.write_text(text.replace(old, new, 1))


replace_once(
    "db-unified.js",
    "    await reviewRequestsCollection.createIndex({ id: 1 }, { unique: true });\n"
    "    await reviewRequestsCollection.createIndex({ supplierId: 1, customerEmail: 1 }); // dedup check\n",
    "    await reviewRequestsCollection.createIndex({ id: 1 }, { unique: true });\n"
    "    await reviewRequestsCollection.createIndex({ supplierId: 1, customerEmail: 1 }); // dedup check\n"
    "    await reviewRequestsCollection.createIndex({ status: 1, expiresAt: 1 });\n",
)

replace_once(
    "server.js",
    "        } catch (apErr) {\n"
    "          logger.warn('   ⚠️  Action Prompt Scheduler failed to initialize:', apErr.message);\n"
    "          logger.warn('   Automated action-prompt emails will not run');\n"
    "        }\n"
    "      } catch (error) {\n",
    "        } catch (apErr) {\n"
    "          logger.warn('   ⚠️  Action Prompt Scheduler failed to initialize:', apErr.message);\n"
    "          logger.warn('   Automated action-prompt emails will not run');\n"
    "        }\n\n"
    "        // 4f. Initialize Review Request Maintenance Scheduler\n"
    "        logger.info('');\n"
    "        logger.info('⭐ Initializing Review Request Maintenance Scheduler...');\n"
    "        try {\n"
    "          const { scheduleMaintenance } = require('./services/reviewRequestMaintenance.service');\n"
    "          const reviewRequestSchedule = scheduleMaintenance();\n"
    "          if (reviewRequestSchedule.scheduled) {\n"
    "            logger.info('   ✅ Review request maintenance scheduled');\n"
    "            logger.info(`   ✅ Cron: ${reviewRequestSchedule.cronExpr}`);\n"
    "            if (reviewRequestSchedule.nextRun) {\n"
    "              logger.info(`   ⏰ Next run: ${reviewRequestSchedule.nextRun.toISOString()}`);\n"
    "            }\n"
    "          } else {\n"
    "            logger.info('   ℹ️  Review request maintenance scheduler disabled');\n"
    "          }\n"
    "        } catch (reviewRequestScheduleError) {\n"
    "          logger.warn(\n"
    "            '   ⚠️  Review Request Maintenance Scheduler failed to initialize:',\n"
    "            reviewRequestScheduleError.message\n"
    "          );\n"
    "        }\n"
    "      } catch (error) {\n",
)
