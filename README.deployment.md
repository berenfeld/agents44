# Deployment — Agents44 (Docker + ECR + AWS)

One Ubuntu 24.04 image runs everywhere: local Docker Compose and AWS. GitHub Actions builds it and pushes to Amazon ECR on every push to `main`.

## Image

| Piece | Who |
|-------|-----|
| Frontend build (`npm`), Python venv, gunicorn, nginx | `root` |
| PostgreSQL | OS user `psql` |
| Claude CLI agent runs | `root` with `IS_SANDBOX=1` (CLI blocks `bypassPermissions` as uid 0 otherwise) |

Tag format: `1.0.<commit-count>.<git-hash>` (example `1.0.59.19dbf81`) plus `latest`.

Local:

```bash
./start-dev.sh
# or: docker compose up --build
```

## GitHub secrets

| Secret | Required | Value |
|--------|----------|-------|
| `AGENTS44_AWS_ACCESS_KEY_ID` | yes | IAM access key |
| `AGENTS44_AWS_SECRET_ACCESS_KEY` | yes | IAM secret key |
| `AGENTS44_ECR_REPOSITORY` | yes | `agents44` or full URI |
| `AGENTS44_AWS_REGION` | no | defaults to `eu-central-1` |

### Get `AGENTS44_ECR_REPOSITORY` from the console

1. AWS Console → region **Europe (Frankfurt) `eu-central-1`**
2. **Elastic Container Registry** → **Repositories** → **Create repository**
   - Visibility: Private
   - Name: `agents44`
3. Open the repo → copy **URI**  
   Example: `123456789012.dkr.ecr.eu-central-1.amazonaws.com/agents44`
4. Put that URI (or just `agents44`) in GitHub secret `AGENTS44_ECR_REPOSITORY`

### Create an IAM user that can push to ECR

1. **IAM** → **Users** → **Create user** (e.g. `agents44-github-ecr`)
2. **Attach policies directly** → create an inline policy (or customer managed) like:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EcrAuth",
      "Effect": "Allow",
      "Action": ["ecr:GetAuthorizationToken"],
      "Resource": "*"
    },
    {
      "Sid": "EcrPush",
      "Effect": "Allow",
      "Action": [
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:PutImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload",
        "ecr:DescribeRepositories",
        "ecr:DescribeImages"
      ],
      "Resource": "arn:aws:ecr:eu-central-1:ACCOUNT_ID:repository/agents44"
    }
  ]
}
```

Replace `ACCOUNT_ID` with your 12-digit account id.

3. Open the user → **Security credentials** → **Create access key** → **Application running outside AWS**
4. Copy Access key ID + Secret into GitHub secrets `AGENTS44_AWS_ACCESS_KEY_ID` / `AGENTS44_AWS_SECRET_ACCESS_KEY`

## Simplest way to run the image on AWS

After the pipeline has pushed to ECR, the simplest managed option is **AWS App Runner** (no cluster to manage; pulls from ECR and gives you an HTTPS URL).

1. Console → **App Runner** → **Create service**
2. Source: **Container registry** → **Amazon ECR** → pick `agents44:latest` (or a version tag)
3. Deployment: Automatic (redeploy when `latest` changes) or Manual
4. Port: **80**
5. Environment / secrets: put the same keys as `.env` (at least `ANTHROPIC_API_KEY`, `FLASK_SECRET_KEY`, `PSQL_*`, `FRONTEND_URL`, Google/SMTP as needed). App Runner injects env vars; you can also mount a secret later via Secrets Manager.
6. Create → wait for the service URL

**Caveats for this all-in-one image on App Runner / Fargate:**

- Postgres data lives inside the container filesystem unless you attach durable storage. For a real environment, attach an **EFS** volume (or move DB to **RDS** later). App Runner has limited persistent storage; **ECS Fargate + EFS** is the next step up if you need durable Postgres/workspace.
- Give the task/service enough CPU/memory (this image runs nginx + gunicorn + Postgres + Claude CLI).
- Terminate TLS at App Runner / ALB; the container listens on HTTP `:80`.

**ECS Fargate** (still simple, more control): create a task definition with the ECR image, port 80, env from Secrets Manager, optional EFS mounts for `/var/lib/psql/data` and `/opt/agents44/workspace`, then a service behind an Application Load Balancer.

## Container `.env`

Mount or inject the same keys as local `.env`. Inside the image, `PSQL_HOST` is forced to `localhost`. Set `FRONTEND_URL` to your public URL (App Runner URL or `https://agents.catch44.co.il`).

## Legacy VM host install

The old zip/SCP + `deploy/scripts/install-server.sh` path is obsolete for CI. Scripts under `deploy/` remain for reference only.
