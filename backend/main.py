from datetime import date, date as CalendarDate
from pathlib import Path
from typing import Annotated, Literal
import secrets
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, ConfigDict

from backend.planner import build_plan
from backend.sharing import create_share, read_share, add_review

app = FastAPI(title='BLANKET & BITES !! — Picnic Planner', version='0.1.0')

from backend.accounts import router as account_router, authorize_workflow
app.include_router(account_router)


@app.middleware('http')
async def private_responses(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith(('/api/auth', '/api/account', '/api/workflows', '/api/chat', '/login.html', '/account.html')):
        response.headers['Cache-Control'] = 'no-store'
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['X-Content-Type-Options'] = 'nosniff'
    return response


class PicnicRequest(BaseModel):
    request: str = Field(default='', max_length=4000)
    date: date
    guests: int = Field(ge=1, le=500)
    location: str = Field(min_length=1, max_length=200)
    budget: float = Field(gt=0, le=100000)
    travel_minutes: int = Field(ge=10, le=120)
    distance_miles: int = Field(default=30, ge=5, le=100)
    food_category: str = Field(default="Vegetarian", pattern="^(Vegetarian|Vegan|Mixed)$")
    participants: list[Annotated[str, Field(max_length=100)]] = Field(default_factory=list, max_length=500)
    dietary_preferences: list[Annotated[str, Field(max_length=50)]] = Field(default_factory=list, max_length=20)


@app.get('/api/health')
def health():
    return {'status': 'ok', 'mode': 'langgraph', 'providers': 'Groq + Tavily'}


@app.get('/picnic.html', include_in_schema=False)
def picnic_page():
    # Both views use the same workspace shell and canonical workflow controller.
    return FileResponse(Path(__file__).resolve().parents[1] / 'frontend' / 'index.html')


@app.post('/api/plans')
def create_plan(request: PicnicRequest):
    return build_plan(request.model_dump(mode='json'))


class ChatRequest(BaseModel):
    message: str = Field(default='', max_length=4000)
    today: date
    thread_id: str | None = Field(default=None, pattern=r'^[A-Za-z0-9_-]{32}$')
    action: Literal['message', 'select', 'food', 'approve', 'share'] = 'message'
    venue_id: str | None = Field(default=None, max_length=100)
    food_mode: Literal['shop', 'order'] | None = None
    food_near: Literal['venue', 'start'] = 'venue'
    food_search_id: str | None = Field(default=None, pattern=r'^[A-Za-z0-9_-]{32}$')
    food_option_id: str | None = Field(default=None, max_length=100)


def workflow_call(thread_id, payload=None, read_only=False):
    from backend.workflow import run
    from backend.providers import ProviderError
    try:
        return run(thread_id, payload, read_only)
    except ProviderError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail='Workflow not found.') from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post('/api/chat')
def chat(request: ChatRequest, http_request: Request):
    thread_id = request.thread_id or secrets.token_urlsafe(24)
    authorize_workflow(thread_id, http_request)
    if request.action == 'message' and not request.message.strip():
        raise HTTPException(status_code=422, detail='Enter a message.')
    return workflow_call(thread_id, request.model_dump(mode='json'))


@app.get('/api/workflows/{thread_id}')
def get_workflow(thread_id: str, http_request: Request):
    if not __import__('re').fullmatch(r'[A-Za-z0-9_-]{32}', thread_id):
        raise HTTPException(status_code=404, detail='Workflow not found.')
    authorize_workflow(thread_id, http_request)
    return workflow_call(thread_id, read_only=True)


class FoodSearchRequest(BaseModel):
    mode: Literal['shop', 'order']
    near: Literal['venue', 'start'] = 'venue'


@app.post('/api/workflows/{thread_id}/food-copy', status_code=201)
def copy_food_workflow(thread_id: str, http_request: Request):
    from backend.workflow import copy_for_food
    authorize_workflow(thread_id, http_request)
    if not __import__('re').fullmatch(r'[A-Za-z0-9_-]{32}', thread_id):
        raise HTTPException(status_code=404, detail='Workflow not found.')
    try:
        return copy_for_food(thread_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail='Workflow not found.') from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post('/api/workflows/{thread_id}/food-options')
def food_options(thread_id: str, request: FoodSearchRequest, http_request: Request):
    from backend.food import find_options
    from backend.providers import ProviderError
    current = get_workflow(thread_id, http_request)
    if not current.get('plan') or current['stage'] not in ('food', 'approval', 'share'):
        raise HTTPException(status_code=409, detail='Choose a picnic place first. Shared plans cannot be changed.')
    try:
        return find_options(thread_id, current['plan'], request.mode, request.near)
    except ProviderError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


class Activity(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    owner: str = Field(min_length=1, max_length=100)


class ShareRequest(BaseModel):
    request: PicnicRequest
    selected_venue: Literal['meadow', 'oak', 'covered']
    food_choices: list[Literal['Brunch', 'Early Dinner', 'Snacks', 'Drinks']] = Field(min_length=1, max_length=4)
    food_source: Literal['Grocery / self catered', 'Restaurant / catering']
    activities: list[Activity] = Field(default_factory=list, max_length=4)


class ReviewRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=100)
    response: Literal['Looks good', 'Suggest a change', 'Cannot make it']
    comment: str = Field(default='', max_length=2000)


@app.post('/api/shares', status_code=201)
def share_plan(request: ShareRequest):
    # Build canonical estimates on the server; share only the selected venue and public details.
    plan = build_plan(request.request.model_dump(mode='json'))
    plan.update(request.model_dump(mode='json', exclude={'request'}))
    plan['venues'] = [v for v in plan['venues'] if v['id'] == plan['selected_venue']]
    plan['request'].pop('participants', None)
    plan['request'].pop('request', None)
    token = create_share(plan)
    return {'token': token, 'path': f'/review.html#{token}'}


@app.get('/api/shares/{token}')
def get_shared_plan(token: str):
    result = read_share(token)
    if result is None:
        raise HTTPException(status_code=404, detail='This review link was not found.')
    return result


@app.post('/api/shares/{token}/reviews', status_code=201)
def submit_review(token: str, review: ReviewRequest):
    if not add_review(token, review.name, review.response, review.comment):
        raise HTTPException(status_code=404, detail='This review link was not found.')
    return {'status': 'received'}


app.mount('/', StaticFiles(directory=Path(__file__).resolve().parents[1] / 'frontend', html=True), name='frontend')
