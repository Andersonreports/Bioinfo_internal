// Configuration
const SHEET_ID = '1ZIs0bbHxkwpo1nUvDcLr-oRei1mUOlaOJISOoeNI6Pc';
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;

let employees = [];

// View Switching Logic
function switchView(viewName) {
    document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`btn-${viewName}-view`).classList.add('active');

    document.querySelectorAll('.view-section').forEach(section => section.style.display = 'none');
    const targetSection = document.getElementById(`${viewName}-view`);
    targetSection.style.display = 'block';
    
    targetSection.style.animation = 'none';
    targetSection.offsetHeight; 
    targetSection.style.animation = null;

    const roleDisplay = document.getElementById('current-role-display');
    roleDisplay.textContent = viewName === 'manager' ? 'Manager' : 'Employee Space';
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

// Fetch Data
async function fetchData() {
    try {
        const response = await fetch(CSV_URL);
        const csvText = await response.text();
        employees = parseCSV(csvText);
        
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
    const searchFilter = document.getElementById('global-search').value.toLowerCase();

    const filtered = employees.filter(emp => {
        const matchesTeam = teamFilter === 'all' || (emp.team && emp.team.toLowerCase().includes(teamFilter.toLowerCase()));
        const matchesLeader = leaderFilter === 'all' || emp.teamLeader === leaderFilter;
        const matchesSearch = emp.name.toLowerCase().includes(searchFilter) || 
                             emp.employeeId.toLowerCase().includes(searchFilter) ||
                             emp.role.toLowerCase().includes(searchFilter);
        
        return matchesTeam && matchesLeader && matchesSearch;
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
    document.getElementById('details-doj').textContent = emp.doj;
    document.getElementById('details-email').textContent = emp.email;
    document.getElementById('details-work').textContent = emp.work;
    document.getElementById('details-analysis').textContent = emp.analysis;
    document.getElementById('details-samples').textContent = emp.samples;

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
            <td>${emp.doj}</td>
            <td><span class="status-badge status-active">${emp.team}</span></td>
            <td>${emp.teamLeader}</td>
        </tr>
    `).join('');
}

// Render Employee Space Cards
function renderEmployeeSpace(data = employees) {
    const container = document.getElementById('employee-cards-container');
    if (!container) return;

    container.innerHTML = data.map(emp => `
        <div class="emp-card glass-panel" onclick="openEmployeeDetails(${emp.id})">
            <div class="emp-card-header">
                <img src="${emp.avatar}" alt="${emp.name}" class="emp-card-avatar">
                <div class="emp-card-info">
                    <h3>${emp.name}</h3>
                    <p>${emp.role}</p>
                    <span class="emp-id-badge">${emp.employeeId}</span>
                </div>
            </div>
            
            <div class="emp-card-actions" onclick="event.stopPropagation()">
                <button class="btn-outline" onclick="triggerUpload(${emp.id})">
                    <i data-lucide="upload-cloud"></i> Upload Cert
                </button>
                <button class="btn-primary" onclick="toggleCerts(${emp.id})">
                    <i data-lucide="eye"></i> View Certs
                </button>
            </div>
            
            <div class="cert-viewer" id="certs-${emp.id}" style="display: none;" onclick="event.stopPropagation()">
                <h4>Conference Certificates</h4>
                ${emp.certificates.length > 0 
                    ? `<ul class="cert-list">
                        ${emp.certificates.map(cert => `
                            <li><i data-lucide="file-text"></i> ${cert}</li>
                        `).join('')}
                       </ul>`
                    : `<p class="no-certs">No certificates uploaded yet.</p>`
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
