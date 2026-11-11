
import "dotenv/config";

import express from "express";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import {
  CloudWatchLogsClient,
  CreateLogStreamCommand,
  PutLogEventsCommand
} from "@aws-sdk/client-cloudwatch-logs";

// ------------------------------------
// Configuration
// ------------------------------------

export const app = express();

app.use(express.json());

const PORT = process.env.PORT || 4000;
const REGION = process.env.AWS_REGION;
const LOG_GROUP = process.env.CLOUDWATCH_LOG_GROUP;

const cloudWatch = new CloudWatchLogsClient({
  region: REGION
});

const logStreamName = `demo-${randomUUID()}`;

// ------------------------------------
// CloudWatch initialization
// ------------------------------------

async function initializeCloudWatch() {
  try {
    await cloudWatch.send(
      new CreateLogStreamCommand({
        logGroupName: LOG_GROUP,
        logStreamName
      })
    );

    console.log("CloudWatch initialized successfully");
    console.log("Log group:", LOG_GROUP);
    console.log("Log stream:", logStreamName);

  } catch (error) {
    console.error("CloudWatch initialization failed:", error);
    throw error;
  }
}

// ------------------------------------
// CloudWatch logger
// ------------------------------------

async function sendToCloudWatch(logData) {
  await cloudWatch.send(
    new PutLogEventsCommand({
      logGroupName: LOG_GROUP,
      logStreamName,
      logEvents: [
        {
          timestamp: Date.now(),
          message: JSON.stringify(logData)
        }
      ]
    })
  );
}

// ------------------------------------
// Health endpoint
// ------------------------------------

app.get("/health", (req, res) => {
  res.json({
    success: true,
    service: "codewarden-demo-service",
    status: "running"
  });
});

// ------------------------------------
// Demo error endpoints
// ------------------------------------

const users = new Map([
  ["demo", { profile: { name: "Demo User" } }],
]);

app.get("/demo/errors/database-timeout", (req, res, next) => {
  const error = new Error(
    "Database connection timeout after 5000ms"
  );

  error.code = "DB_CONNECTION_TIMEOUT";
  error.statusCode = 503;

  next(error);
});

app.get("/demo/errors/null-reference", (req, res) => {
  const userId = String(req.query.userId || "demo");
  const user = users.get(userId);

  res.json({ success: true, name: user.profile.name });
});

app.get("/demo/errors/payment-failure", (req, res, next) => {
  const error = new Error(
    "Payment provider returned HTTP 502"
  );

  error.code = "PAYMENT_PROVIDER_FAILURE";
  error.statusCode = 502;

  next(error);
});

// ------------------------------------
// Error handling middleware
// ------------------------------------

app.use(async (err, req, res, next) => {
  const requestId = randomUUID();

  const errorLog = {
    timestamp: new Date().toISOString(),
    level: "ERROR",
    service: "codewarden-demo-service",
    environment: "development",
    requestId,
    method: req.method,
    path: req.originalUrl,

    error: {
      name: err.name,
      message: err.message,
      code: err.code || "UNKNOWN_ERROR",
      stack: err.stack
    }
  };

  // Local logging
  console.error(JSON.stringify(errorLog, null, 2));

  // CloudWatch logging
  if (LOG_GROUP) {
    try {
      await sendToCloudWatch(errorLog);

      console.log(
        `Successfully sent error to CloudWatch. Request ID: ${requestId}`
      );

    } catch (cloudWatchError) {
      console.error(
        "CloudWatch logging failed:",
        cloudWatchError
      );
    }
  }

  // API response
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message,
    errorCode: err.code,
    requestId
  });
});

// ------------------------------------
// Start server
// ------------------------------------

async function startServer() {
  try {
    if (!REGION || !LOG_GROUP) {
      throw new Error("AWS_REGION and CLOUDWATCH_LOG_GROUP are required");
    }

    await initializeCloudWatch();

    app.listen(PORT, () => {
      console.log("--------------------------------");
      console.log("Codewarden Demo Service Started");
      console.log("--------------------------------");
      console.log(`Server: http://localhost:${PORT}`);
      console.log(`Health: http://localhost:${PORT}/health`);
    });

  } catch (error) {
    console.error("Unable to start application:", error);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
