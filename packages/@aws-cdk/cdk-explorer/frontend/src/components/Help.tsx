import HelpPanel from '@cloudscape-design/components/help-panel';

export function Help() {
  return <HelpPanel header="CDK Explorer">
    <p>
      The CDK Explorer is a tool for visualizing the structure and resources
      that result from synthesizing your AWS Cloud Development Kit (CDK)
      application.
    </p>
    <p>
      Run <code>cdk explore</code> in the directory where your <code>cdk.json</code> file lives.
      The explorer does not run the CDK application itself; it visualizes an
      already-synthesized application, and will automatically update whenever
      <code>cdk synth</code> is run in a different tab.
    </p>
    <h2>Construct Tree</h2>
    <p>
      The construct tree shows the hierarchical structure of your CDK
      application, with each construct represented as a node, identified by its
      {' '}<strong>Construct ID</strong>. You can expand and collapse nodes to
      explore the relationships between constructs.
    </p>
    <p>
      Clicking on a node will restrict the diagnostics panel to diagnostics in
      that subtree of the construct tree. It will also navigate to the source
      line where it is defined and the template line in the synthesized
      CloudFormation template, if available.
    </p>
    <h2>Source View</h2>
    <p>
      Source view shows the source code of your CDK application. It only shows
      those source files that we could trace a construct's creation to, and it does
      not include source files of submodules. Underlines indicate constructs that
      have diagnostics associated with them.
    </p>
    <p>
      With code reuse, a single line of source code may map to multiple concrete
      constructs in the Construct Tree and in the Template View.
    </p>
    <h2>Template View</h2>
    <p>
      Template view shows the synthesized CloudFormation template of your CDK
      application. It provides a low-level view of the resources and their
      properties as they will be deployed to AWS. It only shows templates
      that we could trace a construct's output to.  Underlines indicate
      resources that have diagnostics associated with them.
    </p>
    <h2>Diagnostics Pane</h2>
    <p>
      The diagnostics pane shows synth-time warnings and errors associated with
      the constructs in your CDK application. Click on a diagnostic to show
      the constructs the diagnostic applies to, and click on a construct to
      navigate to its tree, source and template location.
    </p>
  </HelpPanel>;
}
