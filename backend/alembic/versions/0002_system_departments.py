"""system departments table

Revision ID: 0002
"""
import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

LEGACY_DEPARTMENTS = ("research", "data", "validation", "trade")


def upgrade() -> None:
    op.create_table(
        "system_departments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_system_departments_name", "system_departments", ["name"], unique=True)

    for name in LEGACY_DEPARTMENTS:
        op.execute(sa.text("INSERT INTO system_departments (name) VALUES (:name)").bindparams(name=name))

    op.add_column("system_agents", sa.Column("department_new", sa.String(length=128), nullable=True))
    op.execute("UPDATE system_agents SET department_new = department::text")
    op.drop_column("system_agents", "department")
    op.alter_column("system_agents", "department_new", new_column_name="department", nullable=False)
    op.create_foreign_key(
        "fk_system_agents_department",
        "system_agents",
        "system_departments",
        ["department"],
        ["name"],
    )
    op.execute("DROP TYPE department")


def downgrade() -> None:
    op.execute(
        "CREATE TYPE department AS ENUM ('research', 'data', 'validation', 'trade')"
    )
    op.drop_constraint("fk_system_agents_department", "system_agents", type_="foreignkey")
    op.add_column(
        "system_agents",
        sa.Column(
            "department_old",
            sa.Enum("research", "data", "validation", "trade", name="department"),
            nullable=True,
        ),
    )
    op.execute("UPDATE system_agents SET department_old = department::department")
    op.drop_column("system_agents", "department")
    op.alter_column("system_agents", "department_old", new_column_name="department", nullable=False)
    op.drop_index("ix_system_departments_name", table_name="system_departments")
    op.drop_table("system_departments")
