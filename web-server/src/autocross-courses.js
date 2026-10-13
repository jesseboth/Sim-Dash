// Autocross Courses - create, rename and delete courses, and choose a course for recording

const AutocrossCourses = (function () {
    let liveTrackId = null;
    let chooserResolve = null;

    function init() {
        document.getElementById('courseMenuBtn')?.addEventListener('click', openCourseModal);
        document.getElementById('closeCourseModal')?.addEventListener('click', closeCourseModal);
        document.getElementById('courseModal')?.addEventListener('click', (e) => {
            if (e.target.id === 'courseModal') closeCourseModal();
        });
        document.getElementById('renameCourseForm')?.addEventListener('submit', handleRenameCourse);
        document.getElementById('newCourseForm')?.addEventListener('submit', handleNewCourse);
        document.getElementById('deleteCourseBtn')?.addEventListener('click', handleDeleteCourse);

        document.getElementById('cancelCourseChooser')?.addEventListener('click', () => closeChooser(null));
        document.getElementById('courseChooserModal')?.addEventListener('click', (e) => {
            if (e.target.id === 'courseChooserModal') closeChooser(null);
        });
    }

    // Track the driver is on now, from live telemetry (null when not driving)
    async function getLiveTrack() {
        try {
            const res = await fetch(`http://${window.location.hostname}:8888/telemetry`);
            const telem = res.ok ? await res.json() : null;
            if (!telem || !telem.TrackId) return null;

            const trackId = String(telem.TrackId);
            const mappings = await apiRequest('getTrackMappings');
            return { trackId, name: mappings[trackId] || `Track ${trackId}` };
        } catch (e) {
            return null;
        }
    }

    async function openCourseModal() {
        const modal = document.getElementById('courseModal');
        const course = AutocrossApp.getCurrentCourseData();

        document.getElementById('currentCourseSection').classList.toggle('hidden', !course);
        if (course) {
            document.getElementById('courseNameInput').value = course.name;
            const runs = course.runCount || 0;
            document.getElementById('courseInfo').textContent =
                `${runs} run${runs !== 1 ? 's' : ''}` + (course.isArchived ? ' · archived' : '');
        }

        // Offer to link a new course to the track being driven
        const newName = document.getElementById('newCourseName');
        const linkRow = document.getElementById('linkTrackRow');
        const linkCheck = document.getElementById('linkTrackCheck');
        newName.value = '';
        linkRow.classList.add('hidden');
        liveTrackId = null;

        modal.classList.remove('hidden');

        const live = await getLiveTrack();
        if (live) {
            liveTrackId = live.trackId;
            document.getElementById('linkTrackLabel').textContent = `Record runs on ${live.name} into this course`;
            linkCheck.checked = true;
            linkRow.classList.remove('hidden');
            if (!newName.value) newName.placeholder = `e.g., ${live.name} - Layout B`;
        }
    }

    function closeCourseModal() {
        document.getElementById('courseModal')?.classList.add('hidden');
    }

    async function handleRenameCourse(e) {
        e.preventDefault();
        const courseId = AutocrossApp.getCurrentCourse();
        const name = document.getElementById('courseNameInput').value.trim();
        if (!courseId || !name) return;

        try {
            await apiRequest('renameCourse', { courseId, name });
            closeCourseModal();
            await AutocrossApp.refreshRuns();
            showToast('Course renamed', 'success');
        } catch (error) {
            console.error('Failed to rename course:', error);
        }
    }

    async function handleNewCourse(e) {
        e.preventDefault();
        const name = document.getElementById('newCourseName').value.trim();
        if (!name) {
            showToast('Enter a name for the course', 'warning');
            return;
        }

        const linkTrack = liveTrackId && document.getElementById('linkTrackCheck').checked;
        try {
            const course = await apiRequest('createCourse', { name, trackId: linkTrack ? liveTrackId : null });
            closeCourseModal();
            await AutocrossApp.onCourseAutoSelected(course.courseId, `Created course "${name}"`);
        } catch (error) {
            console.error('Failed to create course:', error);
        }
    }

    async function handleDeleteCourse() {
        const course = AutocrossApp.getCurrentCourseData();
        if (!course) return;

        const runs = course.runCount || 0;
        const confirmed = await AutocrossApp.confirmDialog({
            title: 'Delete course',
            message: `"${course.name}" and its ${runs} run${runs !== 1 ? 's' : ''} will be deleted. This cannot be undone. To keep the runs, use Archive instead.`,
            confirmLabel: 'Delete course',
            danger: true
        });
        if (!confirmed) return;

        try {
            await apiRequest('deleteCourse', { courseId: course.courseId });
            closeCourseModal();
            courseSelector.value = '';
            await handleCourseChange();
            renderCourseOptions(await apiRequest('getCourses'));
            showToast('Course deleted', 'success');
        } catch (error) {
            console.error('Failed to delete course:', error);
        }
    }

    // Ask which course to record into. Resolves to a courseId, 'new', or null (cancelled).
    function chooseCourse(courses, trackName) {
        const modal = document.getElementById('courseChooserModal');
        const list = document.getElementById('courseChooserList');
        document.getElementById('courseChooserText').textContent =
            `${trackName} has more than one course. Which one are you driving?`;

        list.innerHTML = '';
        courses.forEach(course => {
            const btn = document.createElement('button');
            btn.className = 'btn btn-secondary course-choice';
            const runs = course.runCount || 0;
            btn.textContent = `${course.name} (${runs} run${runs !== 1 ? 's' : ''})`;
            btn.addEventListener('click', () => closeChooser(course.courseId));
            list.appendChild(btn);
        });

        const newBtn = document.createElement('button');
        newBtn.className = 'btn btn-primary course-choice';
        newBtn.textContent = '+ New course for this track';
        newBtn.addEventListener('click', () => closeChooser('new'));
        list.appendChild(newBtn);

        modal.classList.remove('hidden');
        return new Promise(resolve => { chooserResolve = resolve; });
    }

    function closeChooser(result) {
        document.getElementById('courseChooserModal')?.classList.add('hidden');
        if (chooserResolve) {
            const resolve = chooserResolve;
            chooserResolve = null;
            resolve(result);
        }
    }

    return {
        init,
        chooseCourse
    };
})();

window.AutocrossCourses = AutocrossCourses;

document.addEventListener('DOMContentLoaded', () => {
    AutocrossCourses.init();
});
