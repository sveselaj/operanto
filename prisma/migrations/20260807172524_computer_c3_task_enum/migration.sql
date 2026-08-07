-- Computer C3: new AI task types. In their own migration (= own transaction)
-- because PostgreSQL forbids USING a freshly added enum value in the same
-- transaction that adds it — the next migration's permittedTaskTypes default
-- references these values.
ALTER TYPE "AITaskType" ADD VALUE 'COMPUTER_PAGE_UNDERSTAND';
ALTER TYPE "AITaskType" ADD VALUE 'COMPUTER_GUIDE';
