# BloodBridge backend (AWS free tier)

S3 (site) -> API Gateway HTTP API -> **one Lambda** (`lambda_function.py`) -> DynamoDB, logs in CloudWatch.
Use one region for everything (examples use `ap-south-1`). Never use the root account for this.

## 0. Test locally first (no AWS)
    python test_local.py
Expect "All backend checks passed."

## 1. DynamoDB: 3 tables  (Console -> DynamoDB -> Create table)
| Table name        | Partition key          | Sort key              | Read / Write capacity |
|-------------------|------------------------|-----------------------|-----------------------|
| `BB_Donors`       | `donorId` (String)     | none                  | 10 / 10               |
| `BB_Requests`     | `requestId` (String)   | none                  | 5 / 5                 |
| `BB_Notifications`| `requestId` (String)   | `donorId` (String)    | 5 / 5                 |

For each: **Table settings -> Customize settings -> Capacity mode: Provisioned**, set the numbers above,
and turn **Auto scaling Off** for both read and write.
Total is 20 RCU / 20 WCU, inside the always-free 25 / 25. (Provisioned, not on-demand, is what the free allowance covers.)

## 2. Lambda  (Console -> Lambda -> Create function)
- Name `bb-api`, Runtime **Python 3.12**, Architecture x86_64 (or arm64).
- Open **Code**, replace everything in `lambda_function.py` with this repo's `backend/lambda_function.py`, click **Deploy**.
- **Configuration -> General**: Memory **256 MB**, Timeout **30 s** (the first seed can be slowed by the small write capacity).
- **Do not** put the function in a VPC.
- **Configuration -> Environment variables** (optional): `ALLOWED_ORIGIN` = your S3 website URL once you have it
  (default `*` is fine for the demo).

## 3. Permissions for the Lambda
Console -> IAM -> Roles -> the role Lambda created (`bb-api-role-...`) -> Add permissions -> Create inline policy -> JSON.
Paste `iam-policy.json`, replace `YOUR_ACCOUNT_ID` with your 12-digit account number, name it `BloodBridgeTables`.

## 4. API Gateway  (Console -> API Gateway -> Create API -> **HTTP API** -> Build)
1. Integration: Lambda -> `bb-api`.
2. Route: method **ANY**, resource path **/{proxy+}**.
3. Stage: `$default` with auto-deploy on.
4. **Leave CORS unconfigured.** The Lambda already answers preflight and adds the CORS headers.
5. Copy the **Invoke URL**, like `https://abc123.execute-api.ap-south-1.amazonaws.com`.

## 5. Smoke test
    curl -X POST  https://YOUR_API/seed
    curl          https://YOUR_API/donors
Then in the website's `config.js` set `API_BASE: "https://YOUR_API"` (no trailing slash), reload,
and the badge in the header changes to "Connected: AWS API".

## 6. Put the site on S3 (see the static-hosting steps from before), upload the five frontend files.

## 7. Free-tier guardrails
- Billing -> Budgets -> Zero-spend budget + $1 monthly budget, with your email.
- CloudWatch -> Log groups -> `/aws/lambda/bb-api` -> Retention **7 days**.
- No NAT Gateway, no RDS, no WAF, no CloudFront, no SNS SMS (alerts are simulated in the Notifications table).
- When finished: delete the API, Lambda, tables, bucket.

## 8. Numbers for your report (matching latency etc.)
Every match run logs one JSON line. CloudWatch -> Logs Insights -> select `/aws/lambda/bb-api`:

    parse @message /"latencyMs": (?<latencyMs>[\d.]+)/
    | parse @message /"passedGate": (?<passed>\d+)/
    | filter ispresent(latencyMs)
    | stats count() as runs, avg(latencyMs), max(latencyMs), avg(passed)

Lambda's own `Duration` metric (Monitor tab) gives end-to-end API time.

## Production design (explain, don't build)
RDS Multi-AZ for authoritative records, Cognito + role-based access, Amazon Location Service for road-travel time,
SNS for real SMS/push, EventBridge for automatic timeouts, WAF/CloudFront at the edge, KMS keys, CloudTrail.
