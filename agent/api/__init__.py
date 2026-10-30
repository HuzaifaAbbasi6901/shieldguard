"""API router aggregation (prefix ``/api``)."""

from __future__ import annotations

from fastapi import APIRouter

from api import (
    routes_actions,
    routes_events,
    routes_folders,
    routes_network,
    routes_report,
    routes_settings,
    routes_simulate,
    routes_status,
)

api_router = APIRouter(prefix="/api")
api_router.include_router(routes_status.router)
api_router.include_router(routes_folders.router)
api_router.include_router(routes_events.router)
api_router.include_router(routes_network.router)
api_router.include_router(routes_actions.router)
api_router.include_router(routes_settings.router)
api_router.include_router(routes_simulate.router)
api_router.include_router(routes_report.router)
