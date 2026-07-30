BEGIN;

CREATE TABLE IF NOT EXISTS sponsor_spend (
  spend_day      date   NOT NULL,
  budget_scope   text   NOT NULL
                 CONSTRAINT sponsor_spend_scope CHECK (budget_scope IN ('source', 'global')),
  source_account text   NOT NULL,
  spent_stroops  bigint NOT NULL
                 CONSTRAINT sponsor_spend_nonnegative CHECK (spent_stroops >= 0),
  PRIMARY KEY (spend_day, budget_scope, source_account),
  CONSTRAINT sponsor_spend_account_shape CHECK (
    (budget_scope = 'global' AND source_account = '') OR
    (budget_scope = 'source' AND source_account ~ '^G[A-Z2-7]{55}$')
  )
);

COMMIT;
