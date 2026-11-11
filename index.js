
const express = require("express");

const {
  CloudWatchLogsClient,
  CreateLogGroupCommand,
  CreateLogStreamCommand,
  PutLogEventsCommand,
  FilterLogEventsCommand,
} = require("@aws-sdk/client-cloudwatch-logs");

const app = express();

app.use(express.json());

const PORT = 3000;
const REGION = process.env.AWS_REGION || "ap-south-1";

const LOG_GROUP = "/ec2/nodejs-application";
const LOG_STREAM = "application-logs";

const cloudwatch = new CloudWatchLogsClient({
  region: REGION,
});

// Initialize CloudWatch log group and stream
async function initializeCloudWatch() {
  try {
    await cloudwatch.send(
      new CreateLogGroupCommand({
        logGroupName: LOG_GROUP,
      })
    );
    console.log("CloudWatch log group created");
  } catch (err) {
    if (err.name !== "ResourceAlreadyExistsException") {
      throw err;
    }
  }

  try {
    await cloudwatch.send(
      new CreateLogStreamCommand({
        logGroupName: LOG_GROUP,
        logStreamName: LOG_STREAM,
      })
    );
    console.log("CloudWatch log stream created");
  } catch (err) {
    if (err.name !== "ResourceAlreadyExistsException") {
      throw err;
    }
  }
}

// Send structured logs to CloudWatch
async function sendLog(level, message, details = {}) {
  const logData = {
    timestamp: new Date().toISOString(),
    level,
    message,
    service: "nodejs-ec2-service",
    ...details,
  };

  try {
    await cloudwatch.send(
      new PutLogEventsCommand({
        logGroupName: LOG_GROUP,
        logStreamName: LOG_STREAM,
        logEvents: [
          {
            timestamp: Date.now(),
            message: JSON.stringify(logData),
          },
        ],
      })
    );

    console.log(`[${level}] ${message}`);
  } catch (err) {
    console.error("CloudWatch logging failed:", err);
    throw err;
  }
}

// 1. Health check endpoint
app.get("/", async (req, res) => {
  try {
    await sendLog("INFO", "Health check endpoint accessed");

    res.status(200).json({
      status: "success",
      message: "Node.js CloudWatch application is running",
    });
  } catch (err) {
    res.status(503).json({
      status: "error",
      message: "Logging service unavailable",
    });
  }
});

// 2. Generate normal INFO logs
app.get("/log", async (req, res) => {
  try {
    await sendLog("INFO", "Normal application log generated", {
      endpoint: "/log",
    });

    res.status(200).json({
      status: "success",
      message: "INFO log sent to CloudWatch",
    });
  } catch (err) {
    res.status(500).json({
      status: "error",
      message: "Failed to send log",
    });
  }
});

// 3. Generate intentional ERROR logs
app.get("/error", async (req, res) => {
  const errorMessage = "This is a test application error";

  try {
    await sendLog("ERROR", errorMessage, {
      endpoint: "/error",
      errorCode: "TEST_ERROR_500",
    });
  } catch (err) {
    console.error("Could not send error log to CloudWatch");
  }

  res.status(500).json({
    status: "error",
    message: errorMessage,
    loggedToCloudWatch: true,
  });
});

// 4. Retrieve ERROR logs from CloudWatch
app.get("/logs/errors", async (req, res) => {
  try {
    const minutes = Math.min(
      Math.max(Number(req.query.minutes) || 60, 1),
      1440
    );

    const result = await cloudwatch.send(
      new FilterLogEventsCommand({
        logGroupName: LOG_GROUP,
        logStreamNames: [LOG_STREAM],
        startTime: Date.now() - minutes * 60 * 1000,
        filterPattern: '{ $.level = "ERROR" }',
        limit: 50,
      })
    );

    const errors = (result.events || []).map((event) => {
      try {
        return JSON.parse(event.message);
      } catch {
        return { message: event.message };
      }
    });

    res.status(200).json({
      status: "success",
      totalErrors: errors.length,
      errors,
    });
  } catch (err) {
    console.error("Failed to retrieve CloudWatch errors:", err);

    res.status(500).json({
      status: "error",
      message: "Unable to retrieve error logs from CloudWatch",
    });
  }
});

// Start server after CloudWatch initialization
async function startServer() {
  try {
    await initializeCloudWatch();

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`AWS Region: ${REGION}`);
      console.log(`CloudWatch Group: ${LOG_GROUP}`);
    });
  } catch (err) {
    console.error("Application startup failed:", err);
    process.exit(1);
  }
}

startServer();
