const React = require('react');
const ReactDOM = require('react-dom');
const client = require('./client');
const follow = require('./follow'); // function to hop multiple links by "rel"
const when = require('when');
var stompClient = require('./websocket-listener');

const root = '/api';

class App extends React.Component {

  constructor(props) {
    super(props);
    this.state = {
      employees: [],
      attributes: [],
      pageSize: 2,
      links: {},
      page: {number: 0}
    };
    this.updatePageSize = this.updatePageSize.bind(this);
    this.onCreate = this.onCreate.bind(this);
    this.onDelete = this.onDelete.bind(this);
    this.onUpdate = this.onUpdate.bind(this);
    this.onNavigate = this.onNavigate.bind(this);
    this.refreshCurrentPage = this.refreshCurrentPage.bind(this);
    this.refreshAndGoToLastPage = this.refreshAndGoToLastPage.bind(this);
    console.log('in constructor -- this.state.page: %o', this.state.page);
  }

  loadFromServer(pageSize) {
    follow(client, root, [
      {rel: 'employees', params: {size: pageSize}}]
    ).then(employeeCollection => {
      return client({
        method: 'GET',
        path: employeeCollection.entity._links.profile.href,
        headers: {'Accept': 'application/schema+json'}
      }).then(schema => {
        Object.keys(schema.entity.properties).forEach(function (property) {
          if (schema.entity.properties[property].hasOwnProperty('format') &&
              schema.entity.properties[property].format === 'uri') {
            delete schema.entity.properties[property];
          } else if (schema.entity.properties[property].hasOwnProperty(
              '$ref')) {
            delete schema.entity.properties[property];
          }
        });

        this.schema = schema.entity;
        this.links = employeeCollection.entity._links;
        this.page = employeeCollection.entity.page;
        return employeeCollection;
      });
    }).then(employeeCollection => {
      return employeeCollection.entity._embedded.employees.map(employee =>
          client({
            method: 'GET',
            path: employee._links.self.href
          })
      );
    }).then(employeePromises => {
      return when.all(employeePromises);
    }).done(employees => {
      this.setState({
        page: this.page,
        employees: employees,
        attributes: Object.keys(this.schema.properties),
        pageSize: pageSize,
        links: this.links
      });
    });
  }

  updatePageSize(pageSize) {
    if (pageSize !== this.state.pageSize) {
      this.loadFromServer(pageSize);
    }
  }

  onCreate(newEmployee) {
    follow(client, root, ['employees']).then(employeeCollection => {
      return client({
        method: 'POST',
        path: employeeCollection.entity._links.self.href,
        entity: newEmployee,
        headers: {'Content-Type': 'application/json'}
      })
    });
  }

  onUpdate(employee, updatedEmployee) {
    client({
      method: 'PUT',
      path: employee.entity._links.self.href,
      entity: updatedEmployee,
      headers: {
        'Content-Type': 'application/json',
        'If-Match': employee.headers.Etag
      }
    }).done(response => {
      // this.loadFromServer(this.state.pageSize);
    }, response => {
      if (response.status.code === 412) {
        alert('DENIED: Unable to update ' +
            employee.entity._links.self.href + '. Your copy is stale.');
      }

      if (response.status.code === 403) {
        alert('ACCESS DENIED: You are not authorized to update ' +
            employee.entity._links.self.href);
      }

    });
  }

  onDelete(employee) {
    client({method: 'DELETE', path: employee.entity._links.self.href}).done(
        response => {
          //
        }, response => {
          if (response.status.code === 403) {
            alert('ACCESS DENIED: You are not authorized to delete ' +
                employee.entity._links.self.href);
          }
        });
  }

  onNavigate(navUri) {
    client({
      method: 'GET',
      path: navUri
    }).then(employeeCollection => {
      this.links = employeeCollection.entity._links;
      this.page = employeeCollection.entity.page;

      return employeeCollection.entity._embedded.employees.map(employee =>
          client({
            method: 'GET',
            path: employee._links.self.href
          })
      );
    }).then(employeePromises => {
      return when.all(employeePromises);
    }).done(employees => {
      this.setState({
        page: this.page,
        employees: employees,
        attributes: Object.keys(this.schema.properties),
        pageSize: this.state.pageSize,
        links: this.links
      });
    });
  }

  refreshAndGoToLastPage(message) {
    follow(client, root, [{
      rel: 'employees',
      params: {size: this.state.pageSize}
    }]).done(response => {
      if (response.entity._links.last !== undefined) {
        this.onNavigate(response.entity._links.last.href);
      } else {
        this.onNavigate(response.entity._links.self.href);
      }
    })
  }

  refreshCurrentPage(message) {
    console.log('this.state.page: %o', this.state.page);
    follow(client, root, [{
      rel: 'employees',
      params: {
        size: this.state.pageSize,
        page: this.state.page.number
      }
    }]).then(employeeCollection => {
      this.links = employeeCollection.entity._links;
      this.page = employeeCollection.entity.page;

      return employeeCollection.entity._embedded.employees.map(employee => {
        return client({
          method: 'GET',
          path: employee._links.self.href
        })
      });
    }).then(employeePromises => {
      return when.all(employeePromises);
    }).then(employees => {
      this.setState({
        page: this.page,
        employees: employees,
        attributes: Object.keys(this.schema.properties),
        pageSize: this.state.pageSize,
        links: this.links
      });
    });
  }

  componentDidMount() {
    this.loadFromServer(this.state.pageSize);
    stompClient.register([
      {route: '/topic/newEmployee', callback: this.refreshAndGoToLastPage},
      {route: '/topic/updateEmployee', callback: this.refreshCurrentPage},
      {route: '/topic/deleteEmployee', callback: this.refreshCurrentPage}
    ]);
  }

  render() {
    return (
        <div>
          <CreateDialog attributes={this.state.attributes}
                        onCreate={this.onCreate}/>
          <EmployeeList employees={this.state.employees}
                        links={this.state.links}
                        pageSize={this.state.pageSize}
                        attributes={this.state.attributes}
                        onNavigate={this.onNavigate}
                        onDelete={this.onDelete}
                        onUpdate={this.onUpdate}
                        updatePageSize={this.updatePageSize}/>
        </div>
    )
  }

}

class EmployeeList extends React.Component {
  constructor(props) {
    super(props);
    this.handleNavFirst = this.handleNavFirst.bind(this);
    this.handleNavPrev = this.handleNavPrev.bind(this);
    this.handleNavNext = this.handleNavNext.bind(this);
    this.handleNavLast = this.handleNavLast.bind(this);
    this.handleInput = this.handleInput.bind(this);
  }

  handleNavFirst(e) {
    e.preventDefault();
    this.props.onNavigate(this.props.links.first.href);
  }

  handleNavPrev(e) {
    e.preventDefault();
    this.props.onNavigate(this.props.links.prev.href);
  }

  handleNavNext(e) {
    e.preventDefault();
    this.props.onNavigate(this.props.links.next.href);
  }

  handleNavLast(e) {
    e.preventDefault();
    this.props.onNavigate(this.props.links.last.href);
  }

  handleInput(e) {
    e.preventDefault();
    const pageSize = ReactDOM.findDOMNode(this.refs.pageSize).value;
    if (/^[0-9]+$/.test(pageSize)) {
      this.props.updatePageSize(pageSize);
    } else {
      ReactDOM.findDOMNode(this.refs.pageSize).value =
          pageSize.substring(0, pageSize.length - 1);
    }
  }

  render() {
    const employees = this.props.employees.map(employee =>
        <Employee key={employee.entity._links.self.href}
                  employee={employee}
                  attributes={this.props.attributes}
                  onUpdate={this.props.onUpdate}
                  onDelete={this.props.onDelete}/>
    );

    const navLinks = [];
    if (typeof this.props.links !== "undefined") {
      if ("first" in this.props.links) {
        navLinks.push(<button key="first"
                              onClick={this.handleNavFirst}>&lt;&lt;</button>);
      }
      if ("prev" in this.props.links) {
        navLinks.push(<button key="prev"
                              onClick={this.handleNavPrev}>&lt;</button>);
      }
      if ("next" in this.props.links) {
        navLinks.push(<button key="next"
                              onClick={this.handleNavNext}>&gt;</button>);
      }
      if ("last" in this.props.links) {
        navLinks.push(<button key="last"
                              onClick={this.handleNavLast}>&gt;&gt;</button>);
      }
    }

    return (
        <div>
          <input ref="pageSize" defaultValue={this.props.pageSize}
                 onInput={this.handleInput}/>
          <table>
            <tbody>
            <tr>
              <th>First Name</th>
              <th>Last Name</th>
              <th>Description</th>
              <th>Manager</th>
              <th></th>
            </tr>
            {employees}
            </tbody>
          </table>
          <div>
            {navLinks}
          </div>
        </div>
    )
  }

}

class Employee extends React.Component {

  constructor(props) {
    super(props);
    this.handleDelete = this.handleDelete.bind(this);
  }

  handleDelete() {
    this.props.onDelete(this.props.employee);
  }

  render() {
    return (
        <tr>
          <td>{this.props.employee.entity.firstName}</td>
          <td>{this.props.employee.entity.lastName}</td>
          <td>{this.props.employee.entity.description}</td>
          <td>{this.props.employee.entity.manager.name}</td>
          <td>
            <UpdateDialog employee={this.props.employee}
                          attributes={this.props.attributes}
                          onUpdate={this.props.onUpdate}/>
          </td>
          <td>
            <button onClick={this.handleDelete}>Delete</button>
          </td>
        </tr>
    )
  }
}

class CreateDialog extends React.Component {

  constructor(props) {
    super(props);
    this.handleSubmit = this.handleSubmit.bind(this);
  }

  handleSubmit(e) {
    e.preventDefault();
    const newEmployee = {};
    this.props.attributes.forEach(attribute => {
      newEmployee[attribute] = ReactDOM.findDOMNode(
          this.refs[attribute]).value.trim();
    });
    this.props.onCreate(newEmployee);

    // clear out the dialog's inputs
    this.props.attributes.forEach(attribute => {
      ReactDOM.findDOMNode(this.refs[attribute]).value = '';
    });

    // Navigate away from the dialog to hide it.
    window.location = "#";
  }

  render() {
    const inputs = this.props.attributes.map(attribute =>
        <p key={attribute}>
          <input type="text" placeholder={attribute} ref={attribute}
                 className="field"/>
        </p>
    );

    return (
        <div>
          <a href="#createEmployee">Create</a>

          <div id="createEmployee" className="modalDialog">
            <div>
              <a href="#" title="Close" className="close">X</a>

              <h2>Create new employee</h2>

              <form>
                {inputs}
                <button onClick={this.handleSubmit}>Create</button>
              </form>
            </div>
          </div>
        </div>
    )
  }
}

class UpdateDialog extends React.Component {

  constructor(props) {
    super(props);
    this.handleSubmit = this.handleSubmit.bind(this);
  }

  handleSubmit(e) {
    e.preventDefault();
    const updatedEmployee = {};
    this.props.attributes.forEach(attribute => {
      updatedEmployee[attribute] = ReactDOM.findDOMNode(
          this.refs[attribute]).value.trim();
    });
    this.props.onUpdate(this.props.employee, updatedEmployee);
    window.location = "#";
  }

  render() {
    const inputs = this.props.attributes.map(attribute =>
        <p key={this.props.employee.entity[attribute]}>
          <input type="text" placeholder={attribute}
                 defaultValue={this.props.employee.entity[attribute]}
                 ref={attribute} className="field"/>
        </p>
    );

    const dialogId = "updateEmployee-"
        + this.props.employee.entity._links.self.href;

    return (
        <div key={this.props.employee.entity._links.self.href}>
          <a href={"#" + dialogId}>Update</a>
          <div id={dialogId} className="modalDialog">
            <div>
              <a href="#" title="Close" className="close">X</a>

              <h2>Update an employee</h2>

              <form>
                {inputs}
                <button onClick={this.handleSubmit}>Update</button>
              </form>
            </div>
          </div>
        </div>
    )
  }

}

ReactDOM.render(
    <App/>,
    document.getElementById('react')
);