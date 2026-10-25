from datetime import date
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from backend.planner import build_plan

app = FastAPI(title='Team-9 Project — Smart Picnic Planner', version='0.1.0')


class PicnicRequest(BaseModel):
    request: str = Field(default='', max_length=4000)
    date: date
    guests: int = Field(ge=1, le=500)
    location: str = Field(min_length=1, max_length=200)
    budget: float = Field(gt=0, le=100000)
    travel_minutes: int = Field(ge=10, le=120)
    dietary_preferences: list[Annotated[str, Field(max_length=50)]] = Field(default_factory=list, max_length=20)


@app.get('/api/health')
def health():
    return {'status': 'ok', 'mode': 'demo'}


@app.post('/api/plans')
def create_plan(request: PicnicRequest):
    return build_plan(request.model_dump(mode='json'))


app.mount('/', StaticFiles(directory=Path(__file__).resolve().parents[1] / 'frontend', html=True), name='frontend')
