"""Loopback-only acceptance slice. Synthetic identities, genuine Worker/D1/private R2."""
import base64
import os
import sys
from datetime import date, timedelta
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

url, directory = sys.argv[1:]
out = Path(directory)
photo = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4z8AAAAMBAQCc479ZAAAAAElFTkSuQmCC')
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=os.environ.get('CABMS_CHROME_PATH', r'C:\Program Files\Google\Chrome\Application\chrome.exe'), headless=True)
    def page_for(actor,width,height):
        ctx=browser.new_context(viewport={'width':width,'height':height})
        page=ctx.new_page()
        page.route('**/*', lambda route: route.continue_() if route.request.url.startswith(url+'/') else route.abort())
        page.goto(url+'/?actor='+actor)
        expect(page.get_by_role('heading',name='Operations dashboard')).to_be_visible()
        expect(page.get_by_role('button',name='Switchboard inspection',exact=False).first).to_be_visible()
        return page
    def open_job(page):
        page.get_by_role('button',name='View Jobs & Operations').click()
        page.get_by_role('button',name='Switchboard inspection',exact=False).click()
        expect(page.get_by_role('heading',name='Required compliance forms')).to_be_visible()
    def shot(page,name):
        page.evaluate('window.scrollTo(0, 0)')
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), page.evaluate("[...document.querySelectorAll('body *')].filter(el => el.scrollWidth>el.clientWidth+1 || el.getBoundingClientRect().right > innerWidth).slice(0,16).map(el=>[el.tagName,el.className?.toString().slice(0,80),el.scrollWidth,el.clientWidth,el.getBoundingClientRect().right])")
        page.screenshot(path=str(out/name),full_page=True,animations='disabled')
    def check_dashboard(page):
        page.get_by_label('Business',exact=True).select_option('solarcell')
        counts = page.request.get(url+'/fixture-dashboard-counts').json()
        for label,key in [('Open','open'),('Scheduled','scheduled'),('In progress','in_progress'),('Completed','completed'),('Cancelled','cancelled')]:
            expect(page.get_by_role('button',name=f'{label} jobs {counts[key]}',exact=True)).to_be_visible()
    admin=page_for('admin',1360,900)
    for business in ('solarcell','smart_home','cctv'):
        admin.get_by_label('Active Brand Workspace Selector').select_option(business)
        expect(admin.locator('.cabms-app-shell')).to_have_attribute('data-company-panel',business)
        for preset in ('dark_neutral','dark_company','light_neutral','light_company','high_visibility_dark'):
            admin.get_by_label('Visual Preset Selector').select_option(preset)
            appearance='high_visibility_dark' if preset=='high_visibility_dark' else 'default_dark' if preset.startswith('dark') else 'high_visibility_light'
            expect(admin.locator('html')).to_have_attribute('data-appearance',appearance)
            if preset!='high_visibility_dark':
                expect(admin.locator('html')).to_have_attribute('data-branding',preset.split('_')[1])
            assert admin.locator('.cw-panel').first.evaluate("el=>getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)'")
            shot(admin,business+'-'+preset+'.png')
    admin.get_by_label('Active Brand Workspace Selector').select_option('solarcell')
    admin.get_by_role('button',name='View Jobs & Operations').click()
    admin.get_by_label('Business',exact=True).select_option('cctv')
    with admin.expect_response(lambda response: '/cctv/compliance-jobs?view=creation-options' in response.url) as options:
        admin.get_by_role('button',name='Create New Job').click()
    assert options.value.ok
    expect(admin.get_by_text('Destination business: Gold Coast CCTV')).to_be_visible()
    expect(admin.get_by_role('list',name='Unavailable job types')).to_contain_text('JSA')
    expect(admin.get_by_label('Customer name')).to_be_disabled()
    expect(admin.get_by_role('button',name='Create job',exact=True)).to_be_disabled()
    admin.get_by_role('button',name='Cancel',exact=True).click()
    admin.get_by_label('Business',exact=True).select_option('all')
    admin.get_by_role('button',name='Create New Job').click()
    expect(admin.get_by_text('Destination business: Solarcell')).to_be_visible()
    expect(admin.get_by_label('Customer name')).to_be_enabled()
    admin.get_by_label('Job title').fill('Must stay scoped to Solarcell')
    admin.get_by_label('Active Brand Workspace Selector').select_option('smart_home',force=True)
    expect(admin.get_by_text('The business context changed.',exact=False)).to_be_visible()
    expect(admin.get_by_role('button',name='Create job',exact=True)).to_be_disabled()
    expect(admin.get_by_label('Job title')).to_have_value('Must stay scoped to Solarcell')
    admin.get_by_role('button',name='Cancel',exact=True).click()
    admin.get_by_label('Business',exact=True).select_option('solarcell')
    admin.get_by_role('button',name='Create New Job').click()
    expect(admin.get_by_text('Destination business: Solarcell')).to_be_visible()
    admin.get_by_label('Published job type').select_option('jt-solar-service')
    admin.get_by_label('Job title').fill('Scoped Solarcell fixture')
    admin.get_by_label('Customer name').fill('Scoped fixture customer')
    admin.get_by_label('Service site address').fill('Scoped fixture site')
    with admin.expect_response(lambda response: response.request.method=='POST' and '/solarcell/compliance-jobs' in response.url) as creation:
        admin.get_by_role('button',name='Create job',exact=True).click()
    assert creation.value.status==201
    assert creation.value.request.post_data_json['expected_policy_id']=='pol-solar-service-v1'
    expect(admin.get_by_role('button',name='Scoped Solarcell fixture',exact=False)).to_be_visible()
    invoice_id=creation.value.json()['job_id']
    admin.get_by_role('button',name='Scoped Solarcell fixture',exact=False).click()
    expect(admin.get_by_text('No forms assigned.',exact=False)).to_be_visible()
    with admin.expect_response(lambda resp: resp.request.method=='POST' and f'/{invoice_id}/complete' in resp.url) as invoice_completion:
        admin.get_by_role('button',name='Complete job',exact=True).click()
    assert invoice_completion.value.status==200
    expect(admin.get_by_text('This job is closed.')).to_be_visible()
    admin.get_by_role('navigation',name='Main navigation').get_by_role('button',name='Dashboard',exact=False).click()
    admin.get_by_role('button',name='View Jobs & Operations').click()
    # Filter Business to smart_home while active workspace remains solarcell -> root theme & workspace must NOT change.
    assert admin.evaluate("() => document.documentElement.getAttribute('data-company-panel')") == 'solarcell'
    assert admin.evaluate("() => getComputedStyle(document.documentElement).getPropertyValue('--cabms-brand-primary').trim().toLowerCase()") == '#ffae14'
    admin.get_by_label('Business',exact=True).select_option('smart_home')
    assert admin.evaluate("() => document.documentElement.getAttribute('data-company-panel')") == 'solarcell'
    assert admin.evaluate("() => getComputedStyle(document.documentElement).getPropertyValue('--cabms-brand-primary').trim().toLowerCase()") == '#ffae14'
    # Switch active workspace to smart_home, verify API call, root attributes & theme, and open smart_home job.
    with admin.expect_response(lambda r: r.request.method=='GET' and '/api/v1/workspaces/smart_home/compliance-jobs' in r.url) as sh_jobs:
        admin.get_by_label('Active Brand Workspace Selector').select_option('smart_home')
    assert sh_jobs.value.status == 200
    admin.wait_for_function("() => document.documentElement.getAttribute('data-company-panel') === 'smart_home' && ['#3dae49', '#4be196', '#065f46'].includes(getComputedStyle(document.documentElement).getPropertyValue('--cabms-brand-primary').trim().toLowerCase())")
    admin.get_by_role('button',name='Smart Home authorized workspace fixture',exact=False).click()
    expect(admin.get_by_text('9 Smart Home Street',exact=True)).to_be_visible()
    # Switch header to cctv and verify root attributes, computed theme, and workspace-scoped API request.
    with admin.expect_response(lambda r: r.request.method=='GET' and '/api/v1/workspaces/cctv/' in r.url) as cctv_req:
        admin.get_by_label('Active Brand Workspace Selector').select_option('cctv')
    assert cctv_req.value.status == 200
    admin.wait_for_function("() => document.documentElement.getAttribute('data-company-panel') === 'cctv' && ['#0ba3ad', '#22d3ee', '#155e75'].includes(getComputedStyle(document.documentElement).getPropertyValue('--cabms-brand-primary').trim().toLowerCase())")
    admin.get_by_label('Active Brand Workspace Selector').select_option('solarcell')
    assert admin.evaluate("() => document.documentElement.getAttribute('data-company-panel')") == 'solarcell'
    admin.get_by_role('navigation',name='Main navigation').get_by_role('button',name='Dashboard',exact=False).click()
    check_dashboard(admin)
    admin.get_by_label('Status',exact=True).select_option('COMPLETED')
    expect(admin.get_by_role('button',name='Scoped Solarcell fixture',exact=False)).to_be_visible()
    admin.reload()
    check_dashboard(admin)
    admin.get_by_label('Status',exact=True).select_option('COMPLETED')
    expect(admin.get_by_role('button',name='Scoped Solarcell fixture',exact=False)).to_be_visible()
    office=page_for('office',1360,900)
    shot(office,'01-desktop-dashboard.png')
    office.get_by_label('Status',exact=True).select_option('CANCELLED')
    expect(office.get_by_role('button',name='Switchboard inspection',exact=False)).to_have_count(0)
    office.get_by_label('Status',exact=True).select_option('OPEN')
    office.get_by_role('button',name='View Jobs & Operations').click()
    assert office.get_by_label('Search jobs').evaluate("""input => {
      const icon=input.parentElement.querySelector('svg');
      return parseFloat(getComputedStyle(input).paddingLeft) > icon.getBoundingClientRect().right - input.getBoundingClientRect().left;
    }""")
    expect(office.get_by_text('Preview Adapter',exact=False)).to_have_count(0)
    office.get_by_role('button',name='Create New Job').click()
    expect(office.get_by_role('dialog',name='Create New Work Order')).to_be_visible()
    office.get_by_label('Job title').fill('Browser-created work order')
    office.get_by_label('Customer name').fill('Browser fixture customer')
    office.get_by_label('Service site address').fill('2 Fixture Street')
    policy=office.get_by_label('Published job type')
    policy.select_option('jt-solar-install')
    office.get_by_role('button',name='Create job',exact=True).click()
    expect(office.get_by_role('button',name='Browser-created work order',exact=False)).to_be_visible()
    office.reload()
    expect(office.get_by_role('button',name='Browser-created work order',exact=False)).to_be_visible()
    office.get_by_role('button',name='Browser-created work order',exact=False).click()
    expect(office.get_by_text('2 Fixture Street',exact=True)).to_be_visible()
    shot(office,'06-job-detail.png')
    office.get_by_role('button',name='Manage job').click()
    office.get_by_label('Assigned technician').select_option('test_g01_usr_technician')
    office.get_by_role('button',name='Save assignment').click()
    expect(office.get_by_text('Assignment saved.',exact=True)).to_be_visible()
    office.get_by_label('Reason for addition').fill('Second circuit')
    office.get_by_role('button',name='Add form occurrence').click()
    expect(office.get_by_text('Form added.',exact=True)).to_be_visible()
    office.get_by_role('button',name='Additional',exact=False).click()
    office.get_by_label('Withdrawal reason').fill('Duplicate circuit added in error')
    office.get_by_role('button',name='Request withdrawal').click()
    expect(office.get_by_text('Awaiting administrator decision.')).to_be_visible()
    nav=office.get_by_role('navigation',name='Main navigation')
    nav.get_by_role('button',name='Schedule & Calendar',exact=False).click()
    office.get_by_role('button',name='Schedule visit',exact=True).click()
    office.get_by_label('Work order',exact=True).select_option(label='Browser-created work order')
    office.get_by_role('button',name='Save visit').click()
    expect(office.get_by_text('Visit saved.',exact=True)).to_be_visible()
    office.get_by_role('button',name='Reschedule',exact=True).click()
    original_day = date.fromisoformat(office.get_by_label('Calendar date').input_value())
    moved_day = (original_day + timedelta(days=1)).isoformat()
    office.get_by_label('Visit date').fill(moved_day)
    office.get_by_label('Visit time (Queensland)').fill('14:30')
    office.get_by_label('Duration (minutes)').fill('95')
    office.get_by_role('button',name='Save visit').click()
    expect(office.get_by_label('Calendar date')).to_have_value(moved_day)
    expect(office.get_by_text('14:30 AEST',exact=False)).to_be_visible()
    expect(office.get_by_text('95 min',exact=False)).to_be_visible()
    shot(office,'05-calendar.png')
    moved_visit=office.get_by_role('article').filter(has_text='Browser-created work order')
    moved_visit.get_by_role('button',name='Cancel visit',exact=True).click()
    office.get_by_label('Cancellation reason').fill('Customer changed the visit')
    office.get_by_role('button',name='Save visit').click()
    expect(moved_visit.get_by_text('Visit cancelled',exact=False)).to_be_visible()
    office.reload()
    nav.get_by_role('button',name='Schedule & Calendar',exact=False).click()
    office.get_by_label('Calendar date').fill(moved_day)
    expect(moved_visit.get_by_text('Visit cancelled',exact=False)).to_be_visible()
    moved_visit.get_by_role('button',name='Open Job',exact=True).click()
    expect(office.get_by_role('button',name='Additional',exact=False)).to_be_visible()
    office.get_by_role('button',name='Manage job').click()
    office.get_by_role('button',name='Cancel whole job').click()
    office.get_by_role('button',name='Confirm job cancellation').click()
    expect(office.get_by_text('This job was cancelled.')).to_be_visible()
    office.reload()
    office.get_by_label('Status',exact=True).select_option('CANCELLED')
    office.get_by_role('button',name='Browser-created work order',exact=False).click()
    expect(office.get_by_role('button',name='Additional',exact=False)).to_be_visible()
    office.get_by_text('Activity history',exact=True).click()
    expect(office.get_by_text('cancel · Test G01 Office',exact=False)).to_be_visible()
    office.reload()
    open_job(office)
    office.get_by_role('button',name='Complete job',exact=True).click()
    expect(office.get_by_role('heading',name='What needs attention')).to_be_visible()
    shot(office,'02-office-blockers.png')
    tech=page_for('tech',390,844)
    tech.get_by_role('button',name='Open navigation').click()
    expect(tech.get_by_role('navigation',name='Mobile navigation')).to_be_visible()
    tech.keyboard.press('Escape')
    expect(tech.get_by_role('button',name='Open navigation')).to_be_focused()
    open_job(tech)
    expect(tech.get_by_role('button',name='Complete job',exact=True)).to_be_disabled()
    tech.get_by_role('button',name='Inherited',exact=False).click()
    tech.get_by_label('Result (required)').select_option('FAIL')
    tech.get_by_label('Explain failure (required)').fill('Do not restore this hidden value')
    tech.get_by_label('Result (required)').select_option('PASS')
    expect(tech.get_by_label('Explain failure (required)')).to_have_count(0)
    tech.context.set_offline(True)
    expect(tech.get_by_text('Offline.',exact=False)).to_be_visible()
    expect(tech.get_by_role('button',name='Save answers')).to_be_disabled()
    tech.context.set_offline(False)
    tech.get_by_role('button',name='Back to job',exact=False).click()
    tech.get_by_role('button',name='Inherited',exact=False).click()
    expect(tech.get_by_label('Result (required)')).to_have_value('PASS')
    tech.get_by_label('Result (required)').select_option('FAIL')
    expect(tech.get_by_label('Explain failure (required)')).to_have_value('')
    tech.get_by_label('Result (required)').select_option('PASS')
    def lose_save(route):
        if route.request.method=='PATCH':
            response=route.fetch()
            assert response.ok
            route.abort()
        else:
            route.fallback()
    tech.route('**/compliance-jobs/*',lose_save)
    tech.get_by_role('button',name='Save answers').click()
    expect(tech.get_by_text('Answers saved.',exact=True)).to_be_visible()
    stage_responses = []
    def lose_first_stage(route):
        if route.request.method == 'POST' and not stage_responses:
            response = route.fetch()
            assert response.ok
            stage_responses.append(response.json()['upload_id'])
            route.abort()
        else:
            route.fallback()
    tech.route('**/forms/*/evidence',lose_first_stage)
    tech.get_by_label('Add photo').set_input_files({'name':'inspection.png','mimeType':'image/png','buffer':photo})
    expect(tech.get_by_text('Photo verified.',exact=True)).to_be_visible()
    assert len(stage_responses) == 1
    expect(tech.get_by_text('1 / 20',exact=True)).to_be_visible()
    for count, media in enumerate(('image/jpeg', 'image/webp'), start=2):
        encoded = tech.evaluate("""media => {
          const canvas = document.createElement('canvas');
          canvas.width = media === 'image/jpeg' ? 1200 : 600;
          canvas.height = media === 'image/jpeg' ? 1600 : 800;
          const ctx = canvas.getContext('2d');
          const image = ctx.createImageData(canvas.width, canvas.height);
          let state = 735;
          for (let i = 0; i < image.data.length; i += 4) {
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
            image.data[i] = state >>> 24;
            image.data[i + 1] = (state >>> 16) & 255;
            image.data[i + 2] = (state >>> 8) & 255;
            image.data[i + 3] = 255;
          }
          ctx.putImageData(image, 0, 0);
          return canvas.toDataURL(media, media === 'image/jpeg' ? 0.98 : 0.2);
        }""", media)
        assert encoded.startswith(f'data:{media};base64,')
        variant = base64.b64decode(encoded.split(',', 1)[1])
        if media == 'image/jpeg':
            assert len(variant) > 500 * 1024
        else:
            assert len(variant) <= 500 * 1024
        tech.get_by_label('Add photo').set_input_files({'name': 'test.' + media.split('/')[1], 'mimeType': media, 'buffer': variant})
        expect(tech.get_by_text(f'{count} / 20',exact=True)).to_be_visible()
    tech.get_by_role('button',name='Preview photo 1').click()
    expect(tech.get_by_role('img',name='Verified job evidence photo 1')).to_be_visible()
    tech.get_by_label('I confirm the saved answers and linked evidence for this form occurrence.').check()
    shot(tech,'03-phone-form.png')
    tech.get_by_role('button',name='Sign current version').click()
    expect(tech.get_by_text('Signed snapshot recorded.')).to_be_visible()
    # P1 real-browser correction serialization: FormWork omits READONLY_AUTOFILL (job_ref) on PATCH and re-signs v2.
    tech.unroute('**/compliance-jobs/*',lose_save)
    expect(tech.get_by_label('Job reference · Auto-filled')).to_be_disabled()
    expect(tech.get_by_label('Job reference · Auto-filled')).to_have_value('Switchboard inspection')
    tech.get_by_label('Notes').fill('Corrected note in Chrome')
    with tech.expect_request(lambda req: req.method=='PATCH' and '/compliance-jobs/' in req.url) as patch_req:
        tech.get_by_role('button',name='Save answers').click()
    patch_body=patch_req.value.post_data_json
    assert patch_body['answers']['notes']=='Corrected note in Chrome'
    assert 'job_ref' not in patch_body['answers']
    expect(tech.get_by_text('Answers saved.',exact=True)).to_be_visible()
    tech.get_by_label('Add photo').set_input_files({'name':'correction.png','mimeType':'image/png','buffer':photo})
    expect(tech.get_by_text('Photo verified.',exact=True)).to_be_visible()
    tech.get_by_label('I confirm the saved answers and linked evidence for this form occurrence.').check()
    tech.get_by_role('button',name='Sign current version').click()
    expect(tech.get_by_text('Signed snapshot recorded.')).to_be_visible()
    tech.get_by_label('New finding').fill('Confirm switchboard label')
    tech.get_by_role('button',name='Record finding',exact=True).click()
    expect(tech.get_by_text('Finding recorded.')).to_be_visible()
    tech.get_by_role('button',name='Back to job',exact=False).click()
    expect(tech.get_by_text('1 of 1 signed')).to_be_visible()
    office.reload()
    office.get_by_role('button',name='Scheduled jobs 1').click()
    scheduled = office.get_by_role('button',name='Switchboard inspection',exact=False).first
    expect(scheduled).to_contain_text('Scheduled')
    expect(scheduled).to_contain_text('In progress')
    office.get_by_role('button',name='In progress jobs',exact=False).click()
    expect(scheduled).to_be_visible()
    office.get_by_role('button',name='Open jobs',exact=False).click()
    check_dashboard(office)
    open_job(office)
    office.set_viewport_size({'width':810,'height':1080})
    office.get_by_role('button',name='Complete job',exact=True).click()
    expect(office.get_by_text('Resolve the compliance finding',exact=False)).to_be_visible()
    admin.get_by_label('Active Brand Workspace Selector').select_option('solarcell')
    admin.get_by_label('Status',exact=True).select_option('OPEN')
    open_job(admin)
    admin.get_by_role('button',name='Inherited',exact=False).click()
    admin.get_by_role('button',name='Record resolution').click()
    admin.get_by_label('Resolution for Confirm switchboard label').fill('Label checked against the inspection')
    admin.get_by_role('button',name='Save resolution').click()
    expect(admin.get_by_text('Resolution recorded.')).to_be_visible()
    office.set_viewport_size({'width':1280,'height':900})
    nav.get_by_role('button',name='Schedule & Calendar',exact=False).click()
    office.get_by_label('Calendar date').fill('2025-01-01')
    expect(office.get_by_text('10:00 AEST · Switchboard inspection',exact=True)).to_be_visible()
    office.get_by_role('button',name='Cancel visit',exact=True).click()
    office.get_by_label('Cancellation reason').fill('Reschedule not required after inspection')
    office.get_by_role('button',name='Save visit').click()
    expect(office.get_by_text('Visit cancelled',exact=False)).to_be_visible()
    office.get_by_role('button',name='Open Job',exact=True).click()
    expect(office.get_by_role('heading',name='Switchboard inspection',exact=True)).to_be_visible()
    expect(office.get_by_text('1 of 1 signed')).to_be_visible()
    office.get_by_role('button',name='Inherited',exact=False).click()
    expect(office.get_by_text('4 / 20',exact=True)).to_be_visible()
    office.get_by_role('button',name='Back to job',exact=False).click()
    attempts=[]
    def rejected_recovery(route):
        if route.request.method=='GET':
            route.fulfill(status=404,json={'code':'RESOURCE_NOT_FOUND'})
            return
        attempts.append(route.request.headers['idempotency-key'])
        if len(attempts)==1:
            route.abort()
        else:
            route.fulfill(status=412,json={'code':'VERSION_CONFLICT','detail':'This recovery was rejected. Reload this work order.'})
    office.route('**/complete',rejected_recovery)
    office.get_by_role('button',name='Complete job',exact=True).click()
    expect(office.get_by_role('button',name='Recover operation')).to_be_visible()
    expect(office.get_by_role('button',name='Complete job',exact=True)).to_be_disabled()
    assert len(attempts)==1
    office.get_by_role('button',name='Recover operation').click()
    expect(office.get_by_text('This recovery was rejected.',exact=False)).to_be_visible()
    expect(office.get_by_role('button',name='Recover operation')).to_have_count(0)
    expect(office.get_by_role('button',name='Complete job',exact=True)).to_be_enabled()
    assert len(attempts)==2 and attempts[0]==attempts[1]
    office.unroute('**/complete',rejected_recovery)
    office.set_viewport_size({'width':810,'height':1080})
    office.get_by_role('button',name='Complete job',exact=True).click()
    expect(office.get_by_text('This job is closed.')).to_be_visible()
    shot(office,'04-tablet-completed.png')
    office.set_viewport_size({'width':1280,'height':900})
    nav.get_by_role('button',name='Dashboard',exact=False).click()
    check_dashboard(office)
    office.get_by_label('Status',exact=True).select_option('COMPLETED')
    expect(office.get_by_role('button',name='Switchboard inspection',exact=False)).to_be_visible()
    browser.close()
