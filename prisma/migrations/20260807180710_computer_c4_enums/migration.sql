-- Computer C4: the single navigation primitive and the execution states.
-- Enum additions live in their own migration (own transaction) because
-- PostgreSQL forbids USING a freshly added enum value in the same
-- transaction that adds it.
ALTER TYPE "ComputerActionType" ADD VALUE 'OPEN_SAFE_LINK' BEFORE 'OBSERVE';
ALTER TYPE "ComputerActionStatus" ADD VALUE 'EXECUTING';
ALTER TYPE "ComputerActionStatus" ADD VALUE 'EXECUTED';
ALTER TYPE "ComputerActionStatus" ADD VALUE 'EXECUTION_FAILED';
