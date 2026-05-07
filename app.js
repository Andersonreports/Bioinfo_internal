// Configuration
const SHEET_ID = '1ZIs0bbHxkwpo1nUvDcLr-oRei1mUOlaOJISOoeNI6Pc';
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;

let employees = [];

// View Switching Logic
function switchView(viewName) {
    // Remove active from ALL nav tabs
    document.querySelectorAll('.nav-tab').forEach(btn => btn.classList.remove('active'));
    // Add active only to the selected tab
    const activeBtn = document.getElementById(`btn-${viewName}-view`);
    if (activeBtn) activeBtn.classList.add('active');

    document.querySelectorAll('.view-section').forEach(section => section.style.display = 'none');
    const targetSection = document.getElementById(`${viewName}-view`);
    if (targetSection) {
        targetSection.style.display = 'block';
        targetSection.style.animation = 'none';
        targetSection.offsetHeight;
        targetSection.style.animation = null;
    }
}

// Sidebar Logic
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('sidebar-toggle-btn');
    sidebar.classList.toggle('collapsed');
    
    const icon = sidebar.classList.contains('collapsed') ? 'chevron-right' : 'chevron-left';
    toggleBtn.innerHTML = `<i data-lucide="${icon}"></i>`;
    lucide.createIcons();
}

// CSV Parser
function parseCSV(csv) {
    const lines = csv.split('\n');
    const result = [];
    const headers = lines[0].split(',').map(h => h.trim());

    for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        
        // Handle quoted values (comma inside quotes)
        const row = [];
        let current = '';
        let inQuotes = false;
        
        for (let char of lines[i]) {
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                row.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        row.push(current.trim());

        const obj = {};
        headers.forEach((header, index) => {
            obj[header] = row[index] || '';
        });
        
        // Map CSV fields to our internal employee object
        if (obj['Name']) {
            result.push({
                id: i,
                employeeId: obj['Employee ID'] || `GEN-${100 + i}`,
                name: obj['Name'],
                role: obj['Role'] || 'Bioinformatician',
                email: `${obj['Name'].toLowerCase().replace(/\s+/g, '.')}@genomicdesk.com`,
                doj: obj['Date of Joining'] || 'N/A',
                team: obj['Team'] || 'Primary',
                teamLeader: obj['Team Leader name'] || 'N/A',
                samples: obj['Report/sample types'] || 'N/A',
                analysis: obj['Analysis'] || 'N/A',
                work: obj['Work'] || 'N/A',
                certificates: [],
                avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(obj['Name'])}&background=random&color=fff`
            });
        }
    }
    return result;
}

// Format date from DD/MM/YYYY → "12th Mar 2026"
function formatDate(dateStr) {
    if (!dateStr || dateStr === 'N/A') return 'N/A';
    const parts = dateStr.split('/');
    if (parts.length !== 3) return dateStr;
    const [day, month, year] = parts.map(Number);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const suffix = (d) => {
        if (d >= 11 && d <= 13) return 'th';
        switch (d % 10) {
            case 1: return 'st';
            case 2: return 'nd';
            case 3: return 'rd';
            default: return 'th';
        }
    };
    return `${day}${suffix(day)} ${months[month - 1]} ${year}`;
}

// Fetch Data
async function fetchData() {
    try {
        const response = await fetch(CSV_URL);
        const csvText = await response.text();
        const rawEmployees = parseCSV(csvText);
        
        // Sort by Joining Date (DD/MM/YYYY) - Ascending (First joined first displayed)
        employees = rawEmployees.sort((a, b) => {
            const parseDate = (dateStr) => {
                if (!dateStr || dateStr === 'N/A') return new Date(0);
                const [day, month, year] = dateStr.split('/').map(Number);
                return new Date(year, month - 1, day);
            };
            return parseDate(a.doj) - parseDate(b.doj);
        });
        
        populateTeamLeaders();
        updateKPIs();
        renderEmployees();
        renderEmployeeSpace();
    } catch (error) {
        console.error('Error fetching data:', error);
    }
}

function populateTeamLeaders() {
    const leaderSelect = document.getElementById('filter-leader');
    if (!leaderSelect) return;

    const leaders = [...new Set(employees.map(emp => emp.teamLeader))].filter(l => l && l !== 'N/A' && l !== 'Team Leader name' && l.trim() !== '');
    
    // Clear existing options except first
    leaderSelect.innerHTML = '<option value="all">All Leaders</option>';
    leaders.sort().forEach(leader => {
        const option = document.createElement('option');
        option.value = leader;
        option.textContent = leader;
        leaderSelect.appendChild(option);
    });
}

function updateKPIs() {
    document.getElementById('kpi-total-team').textContent = employees.length;
    const activeTeams = [...new Set(employees.map(emp => emp.team))].filter(t => t && t !== 'Team' && t.trim() !== '').length;
    document.getElementById('kpi-active-teams').textContent = activeTeams;
}

// Filtering Logic
function handleFilterChange() {
    const teamFilter = document.getElementById('filter-team').value;
    const leaderFilter = document.getElementById('filter-leader').value;
    const sampleFilter = document.getElementById('filter-sample').value;

    const filtered = employees.filter(emp => {
        const matchesTeam = teamFilter === 'all' || (emp.team && emp.team.toLowerCase().includes(teamFilter.toLowerCase()));
        const matchesLeader = leaderFilter === 'all' || emp.teamLeader === leaderFilter;
        const matchesSample = sampleFilter === 'all' || (emp.samples && emp.samples.toLowerCase().includes(sampleFilter.toLowerCase()));
        
        return matchesTeam && matchesLeader && matchesSample;
    });

    renderEmployees(filtered);
    renderEmployeeSpace(filtered);
}

// Modal Logic
function openEmployeeDetails(id) {
    const emp = employees.find(e => e.id === id);
    if (!emp) return;

    document.getElementById('details-avatar').src = emp.avatar;
    document.getElementById('details-name').textContent = emp.name;
    document.getElementById('details-role').textContent = emp.role;
    document.getElementById('details-id').textContent = emp.employeeId;
    document.getElementById('details-team').textContent = emp.team;
    document.getElementById('details-leader').textContent = emp.teamLeader;
    document.getElementById('details-doj').textContent = formatDate(emp.doj);
    document.getElementById('details-email').textContent = emp.email;

    // Helper to render lists
    const renderList = (text) => {
        if (!text) return 'N/A';
        const items = text.split(',').map(item => item.trim()).filter(item => item !== "");
        return `<ul class="details-list">${items.map(item => `<li>${item}</li>`).join('')}</ul>`;
    };

    document.getElementById('details-work').innerHTML = renderList(emp.work);
    document.getElementById('details-analysis').innerHTML = renderList(emp.analysis);
    document.getElementById('details-samples').innerHTML = renderList(emp.samples);

    document.getElementById('employee-details-modal').style.display = 'flex';
}

function closeDetailsModal(event) {
    if (event && event.target !== event.currentTarget) return;
    document.getElementById('employee-details-modal').style.display = 'none';
}

// Render Manager Directory
function renderEmployees(data = employees) {
    const tbody = document.getElementById('employee-table-body');
    if (!tbody) return;
    
    tbody.innerHTML = data.map(emp => `
        <tr onclick="openEmployeeDetails(${emp.id})" style="cursor: pointer;">
            <td>
                <div class="emp-cell">
                    <img src="${emp.avatar}" alt="${emp.name}" class="emp-avatar">
                    <div>
                        <div class="emp-name">${emp.name}</div>
                        <div class="emp-email">${emp.email}</div>
                    </div>
                </div>
            </td>
            <td>${emp.employeeId}</td>
            <td>${emp.role}</td>
            <td>${formatDate(emp.doj)}</td>
            <td><span class="status-badge status-active">${emp.team}</span></td>
            <td>${emp.teamLeader}</td>
        </tr>
    `).join('');
}

// Render Employee Space Cards (Circular Stat Cards)
function renderEmployeeSpace(data = employees) {
    const container = document.getElementById('employee-cards-container');
    if (!container) return;

    container.innerHTML = data.map(emp => `
        <div class="emp-stat-card" onclick="openEmployeeDetails(${emp.id})">
            <div class="stat-circle">
                <div class="stat-progress"></div>
                <img src="${emp.avatar}" alt="${emp.name}" class="stat-avatar">
                <div class="stat-badge">${emp.team}</div>
            </div>
            <div class="stat-info">
                <h3>${emp.name}</h3>
                <p>${emp.role}</p>
                <div class="stat-meta">
                    <span>${emp.employeeId}</span>
                </div>
            </div>
            
            <div class="emp-card-actions" onclick="event.stopPropagation()">
                <button class="icon-btn-small" onclick="triggerUpload(${emp.id})" title="Upload Certificate">
                    <i data-lucide="upload-cloud"></i>
                </button>
                <button class="icon-btn-small" onclick="toggleCerts(${emp.id})" title="View Certificates">
                    <i data-lucide="eye"></i>
                </button>
            </div>
            
            <div class="cert-viewer" id="certs-${emp.id}" style="display: none;" onclick="event.stopPropagation()">
                <h4>Certificates</h4>
                ${emp.certificates.length > 0 
                    ? `<ul class="cert-list">
                        ${emp.certificates.map(cert => `
                            <li>${cert}</li>
                        `).join('')}
                       </ul>`
                    : `<p class="no-certs">No certs</p>`
                }
            </div>
        </div>
    `).join('');
    
    lucide.createIcons();
}

// Certificate Logic
function triggerUpload(empId) {
    const fileName = prompt("Enter the name of the certificate file to upload (e.g., 'React_Summit.pdf'):");
    if (fileName && fileName.trim() !== "") {
        const emp = employees.find(e => e.id === empId);
        if (emp) {
            emp.certificates.push(fileName.trim());
            alert(`${fileName} uploaded successfully for ${emp.name}!`);
            renderEmployeeSpace();
            const certViewer = document.getElementById(`certs-${empId}`);
            if(certViewer) certViewer.style.display = 'block';
        }
    }
}

function toggleCerts(empId) {
    const certViewer = document.getElementById(`certs-${empId}`);
    if (certViewer) {
        certViewer.style.display = certViewer.style.display === 'none' ? 'block' : 'none';
    }
}

// Add New Employee Logic
function openAddEmployeeModal() {
    document.getElementById('add-employee-modal').style.display = 'flex';
}

function closeAddEmployeeModal() {
    document.getElementById('add-employee-modal').style.display = 'none';
    document.getElementById('add-emp-form').reset();
}

function handleAddEmployee(event) {
    event.preventDefault();
    const name = document.getElementById('emp-name').value;
    const email = document.getElementById('emp-email').value;
    const employeeId = document.getElementById('emp-id').value;
    const role = document.getElementById('emp-role').value;
    const doj = document.getElementById('emp-doj').value;
    const leader = document.getElementById('emp-leader').value;
    const team = document.getElementById('emp-team').value;

    const newEmp = {
        id: employees.length + 1,
        employeeId: employeeId,
        name: name,
        role: role,
        email: email,
        doj: doj,
        teamLeader: leader,
        team: team,
        work: 'N/A',
        analysis: 'N/A',
        samples: 'N/A',
        certificates: [],
        avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random&color=fff`
    };

    employees.unshift(newEmp);
    closeAddEmployeeModal();
    
    populateTeamLeaders();
    updateKPIs();
    renderEmployees();
    renderEmployeeSpace();
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    fetchData();
    lucide.createIcons();
    
    const addForm = document.getElementById('add-emp-form');
    if(addForm) {
        addForm.addEventListener('submit', handleAddEmployee);
    }
});
